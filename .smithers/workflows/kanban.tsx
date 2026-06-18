// smithers-source: seeded
// smithers-display-name: Kanban
// smithers-description: Implement ticket files from `.smithers/tickets/` in worktree branches with a Kanban UI.
// smithers-tags: tickets, ui, worktrees
/** @jsxImportSource smithers-orchestrator */
import {
  createSmithers,
  Sequence,
  Parallel,
  Worktree,
} from "smithers-orchestrator";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod/v4";
import { agents } from "../agents";
import {
  ValidationLoop,
  buildValidationReviewGate,
  implementOutputSchema,
  validateOutputSchema,
} from "../components/ValidationLoop";
import {
  reviewContextOutputSchema,
  reviewFindingOutputSchema,
  reviewOutputSchema,
  reviewSynthesisNodeId,
} from "../components/Review";
import MergeTicketsPrompt from "../prompts/merge-tickets.mdx";

const ticketResultSchema = z.object({
  ticketId: z.string(),
  branch: z.string(),
  status: z.enum(["success", "partial", "failed"]),
  summary: z.string(),
});

const mergeResultSchema = z.object({
  merged: z.array(z.string()),
  conflicted: z.array(z.string()),
  summary: z.string(),
});

const inputSchema = z.object({
  maxConcurrency: z.number().int().min(1).max(10).default(3),
});

const ticketListSchema = z.object({
  tickets: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
    })
  ),
});

const { Workflow, Task, smithers, outputs } = createSmithers({
  input: inputSchema,
  tickets: ticketListSchema,
  implement: implementOutputSchema,
  validate: validateOutputSchema,
  reviewContext: reviewContextOutputSchema,
  reviewFinding: reviewFindingOutputSchema,
  review: reviewOutputSchema,
  ticketResult: ticketResultSchema,
  merge: mergeResultSchema,
});

function discoverTickets(): Array<{
  id: string;
  slug: string;
  content: string;
}> {
  const ticketsDir = resolve(process.cwd(), ".smithers/tickets");
  try {
    return readdirSync(ticketsDir, { withFileTypes: true })
      .filter(
        (e) => e.isFile() && e.name.endsWith(".md") && e.name !== ".gitkeep"
      )
      .map((e) => {
        const content = readFileSync(resolve(ticketsDir, e.name), "utf8");
        const slug = e.name.replace(/\.md$/, "");
        return { id: e.name, slug, content };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

function ticketTitle(ticket: {
  id: string;
  slug: string;
  content: string;
}): string {
  const heading = ticket.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading && heading.length > 0
    ? heading
    : ticket.slug
        .replace(/__/g, " / ")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Build feedback string from validation + review outputs for a ticket. */
function buildFeedback(
  ctx: any,
  slug: string
): { feedback: string | null; done: boolean } {
  const gate = buildValidationReviewGate({
    validate: ctx.latest("validate", `${slug}:validate`),
    review: ctx.latest("review", reviewSynthesisNodeId(`${slug}:review`)),
  });
  return { feedback: gate.feedback, done: gate.done };
}

export default smithers((ctx) => {
  const tickets = discoverTickets();
  const maxConcurrency = ctx.input.maxConcurrency;
  const ticketResults = ctx.outputs.ticketResult ?? [];

  return (
    <Workflow name="kanban">
      <Sequence>
        <Task id="tickets" output={outputs.tickets}>
          {{
            tickets: tickets.map((ticket) => ({
              id: ticket.id,
              slug: ticket.slug,
              title: ticketTitle(ticket),
            })),
          }}
        </Task>

        {/* Implement each ticket in its own worktree branch, in parallel */}
        <Parallel maxConcurrency={maxConcurrency}>
          {tickets.map((ticket) => {
            const { feedback, done } = buildFeedback(ctx, ticket.slug);
            return (
              <Worktree
                key={ticket.slug}
                path={resolve(process.cwd(), ".worktrees", ticket.slug)}
                branch={`ticket/${ticket.slug}`}
              >
                <Sequence>
                  <ValidationLoop
                    idPrefix={ticket.slug}
                    prompt={`Implement the ticket below.\n\nTICKET FILE: .smithers/tickets/${ticket.id}\n\n${ticket.content}`}
                    implementAgents={agents.engineer}
                    validateAgents={agents.cheapFast}
                    reviewContextAgent={agents.reviewContext}
                    reviewAgents={agents.review}
                    reviewSynthesisAgent={agents.reviewSynthesis}
                    feedback={feedback}
                    done={done}
                    maxIterations={3}
                  />
                  <Task
                    id={`result-${ticket.slug}`}
                    output={outputs.ticketResult}
                    continueOnFail
                  >
                    {{
                      ticketId: ticket.id,
                      branch: `ticket/${ticket.slug}`,
                      status: "success",
                      summary: `Implemented ${ticket.slug}`,
                    }}
                  </Task>
                </Sequence>
              </Worktree>
            );
          })}
        </Parallel>

        {/* Agent merges completed branches back into main */}
        <Task id="merge" output={outputs.merge} agent={agents.smart}>
          <MergeTicketsPrompt
            ticketSummary={ticketResults
              .map(
                (r) =>
                  `- ${r.ticketId}: branch "${r.branch}" — ${r.status} (${r.summary})`
              )
              .join("\n")}
          />
        </Task>
      </Sequence>
    </Workflow>
  );
});
