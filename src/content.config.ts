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
		demoComponent: z.string().optional(),
		order: z.number().default(0),
	}),
});

export const collections = { projects };
