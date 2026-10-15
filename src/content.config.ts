import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const projects = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "src/content/projects" }),
	schema: z.object({
		title: z.string(),
		summary: z.string(),
		role: z.string(),
		tags: z.array(z.string()),
		period: z.string(),
		status: z.enum(["completed", "ongoing"]),
		thumbnail: z.string().optional(),
		gallery: z.array(z.string()).optional(),
		links: z
			.array(
				z.object({
					label: z.string(),
					url: z.string(),
				}),
			)
			.optional(),
		hasDemo: z.boolean().default(false),
		// Enumerated rather than a free string so a typo fails the build
		// instead of silently rendering no demo. Keep in sync with the
		// components wired up in src/components/DemoSlot.astro.
		demoComponent: z
			.enum(["SousVideDashboard", "CameraSystemDiagram"])
			.optional(),
		// A project with its own page links there from its card instead of
		// opening a modal (e.g. the ROV's scroll story at /projects/rov/).
		page: z.string().optional(),
		order: z.number().default(0),
	})
	.refine((data) => !data.hasDemo || data.demoComponent !== undefined, {
		message:
			"hasDemo: true requires a demoComponent — otherwise the card shows a 'Live demo' badge with nothing behind it.",
		path: ["demoComponent"],
	}),
});

export const collections = { projects };
