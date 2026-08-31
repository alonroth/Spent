import "server-only";

import { GoogleGenAI } from "@google/genai";
import type {
  AIProvider,
  CategoryForCategorization,
  CategoryMapping,
  PastCorrection,
  TransactionForCategorization,
} from "../types";
import { buildCategorizationPrompt, SYSTEM_PROMPT } from "../prompts";
import { parseCategoryResponse } from "../parse-category-response";

type GeminiModel = "gemini-3.7-flash" | "gemini-3.5-flash-lite";

const CATEGORY_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      index: { type: "integer" },
      categoryName: { type: "string" },
      confidence: { type: "integer", minimum: 1, maximum: 7 },
      isNew: { type: "boolean" },
    },
    required: ["index", "categoryName", "confidence"],
  },
} as const;

export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI;

  constructor(apiKey: string, private model: GeminiModel) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async categorize(
    transactions: TransactionForCategorization[],
    categories: CategoryForCategorization[],
    options?: { allowProposals?: boolean; pastCorrections?: PastCorrection[] }
  ): Promise<CategoryMapping[]> {
    const prompt = buildCategorizationPrompt(
      transactions,
      categories,
      options?.allowProposals ?? false,
      options?.pastCorrections ?? []
    );

    const response = await this.client.interactions.create({
      model: this.model,
      input: `${SYSTEM_PROMPT}\n\n${prompt}`,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: CATEGORY_SCHEMA,
      },
    });

    return parseCategoryResponse(
      response.output_text ?? "",
      categories.map((c) => c.name),
      options?.allowProposals ?? false,
      transactions.length
    );
  }
}
