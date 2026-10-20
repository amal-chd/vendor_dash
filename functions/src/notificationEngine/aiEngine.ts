import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI, Type } from "@google/genai";
import * as admin from "firebase-admin";
import { z } from "zod";
import { logAiGeneration } from "./aiAudit";
import { AppTarget } from "./types";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const MODEL_NAME = "gemini-2.5-flash";

const notificationSchema = z.object({
  title: z.string().max(65),
  body: z.string().max(178),
  app: z.string(),
  channel: z.string().optional(),
});

const generateResultSchema = z.object({
  campaignName: z.string(),
  notifications: z.array(notificationSchema),
});

const generatePlanSchema = z.object({
  days: z.array(z.object({
    day: z.number(),
    theme: z.string(),
    title: z.string(),
    body: z.string(),
    recommendedTime: z.string(),
    reasoning: z.string(),
  }))
});

const recommendScheduleSchema = z.object({
  recommendedTime: z.string(),
  expectedAudience: z.number(),
  reason: z.string(),
  alternativeTimes: z.array(z.string()),
});

export const generateNotificationContent = onCall({
  maxInstances: 2,
  secrets: [GEMINI_API_KEY],
}, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const {
    prompt, objective, audience, apps, channels, tone, language, schedulingMode
  } = request.data;

  if (!prompt) {
    throw new HttpsError("invalid-argument", "Prompt is required");
  }

  const systemInstruction = `You are KADA's AI Notification Copywriter.
KADA is an ecosystem with multiple apps: customer, vendor, rider, host, and admin.
Your task is to generate push notification content based on the user's prompt.
Strictly adhere to the provided JSON schema.
Tone: ${tone || "professional, engaging, concise"}
Language: ${language || "English"}
Character limits: Title maximum 65 chars, Body maximum 178 chars.
Generate content for these apps: ${apps ? apps.join(", ") : "all applicable apps"}.
Objective: ${objective || "communication"}.
Channels: ${channels ? channels.join(", ") : "push"}.
`;

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

  const attemptGeneration = async (errorFeedback?: string) => {
    let finalPrompt = `Prompt: ${prompt}\nAudience: ${audience || "all"}\nScheduling Mode: ${schedulingMode || "immediate"}`;
    if (errorFeedback) {
      finalPrompt += `\n\nPREVIOUS ERROR (fix this in your output): ${errorFeedback}`;
    }

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: finalPrompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            campaignName: { type: Type.STRING },
            notifications: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  body: { type: Type.STRING },
                  app: { type: Type.STRING },
                  channel: { type: Type.STRING },
                },
                required: ["title", "body", "app"],
              },
            },
          },
          required: ["campaignName", "notifications"],
        },
      },
    });

    return response.text || "";
  };

  let rawResponse = "";
  let parsedResult = null;
  let validationStatus: "success" | "failed" = "failed";
  let validationErrors = null;

  try {
    rawResponse = await attemptGeneration();
    const rawParsed = JSON.parse(rawResponse);
    parsedResult = generateResultSchema.parse(rawParsed);
    validationStatus = "success";
  } catch (err: any) {
    try {
      rawResponse = await attemptGeneration(err.message);
      const rawParsed = JSON.parse(rawResponse);
      parsedResult = generateResultSchema.parse(rawParsed);
      validationStatus = "success";
      validationErrors = null;
    } catch (retryErr: any) {
      validationErrors = retryErr.message || "Failed validation twice";
    }
  }

  await logAiGeneration({
    requestPrompt: prompt,
    systemInstruction,
    rawResponse,
    finalContent: JSON.stringify(parsedResult || {}),
    validationResult: validationStatus === "success",
    adminId: request.auth?.uid || "unknown",
    adminEmail: email,
    model: MODEL_NAME,
    timestamp: admin.firestore.Timestamp.now(),
  });

  if (validationStatus === "failed") {
    throw new HttpsError("internal", `Generation failed validation. Raw output: ${rawResponse}`);
  }

  return parsedResult;
});

export const generateMultiAppContent = onCall({
  maxInstances: 2,
  secrets: [GEMINI_API_KEY],
}, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { campaignConcept, targetApps } = request.data;
  
  if (!campaignConcept || !targetApps || !Array.isArray(targetApps)) {
    throw new HttpsError("invalid-argument", "campaignConcept and targetApps are required");
  }

  const systemInstruction = `You are KADA's AI Notification Copywriter.
Given a campaign concept, generate contextually appropriate push notification content for specific target apps.
- Customers: promotional, engaging
- Vendors: business-focused, actionable
- Riders: opportunity-driven, clear
- Admin: operational, informative
Character limits: Title maximum 65 chars, Body maximum 178 chars.
Respond ONLY with JSON matching the provided schema.`;

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Campaign Concept: ${campaignConcept}\nTarget Apps: ${targetApps.join(", ")}`,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          campaignName: { type: Type.STRING },
          notifications: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                body: { type: Type.STRING },
                app: { type: Type.STRING },
              },
              required: ["title", "body", "app"],
            },
          },
        },
        required: ["campaignName", "notifications"],
      },
    },
  });

  try {
    const parsed = JSON.parse(response.text || "{}");
    const result = generateResultSchema.parse(parsed);
    return result;
  } catch (err: any) {
    throw new HttpsError("internal", `Failed to parse AI response: ${err.message}`);
  }
});

export const recommendSchedule = onCall({
  maxInstances: 2,
  secrets: [GEMINI_API_KEY],
}, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { audienceType, objective, historicalData } = request.data;

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  
  const systemInstruction = `You are KADA's AI Notification Scheduler.
Based on audience type, campaign objective, and historical engagement data, recommend the optimal send time.
Return a structured JSON.`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Audience: ${audienceType}\nObjective: ${objective}\nHistorical Data: ${historicalData || "None"}`,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommendedTime: { type: Type.STRING },
          expectedAudience: { type: Type.NUMBER },
          reason: { type: Type.STRING },
          alternativeTimes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["recommendedTime", "expectedAudience", "reason", "alternativeTimes"],
      },
    },
  });

  try {
    const parsed = JSON.parse(response.text || "{}");
    const result = recommendScheduleSchema.parse(parsed);
    return result;
  } catch (err: any) {
    throw new HttpsError("internal", `Failed to parse AI response: ${err.message}`);
  }
});

export const generateCampaignPlan = onCall({
  maxInstances: 2,
  secrets: [GEMINI_API_KEY],
}, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { durationDays, objective, location, audience } = request.data;

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const systemInstruction = `You are KADA's AI Campaign Planner.
Generate a multi-day notification campaign sequence.
Return structured JSON.`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Duration: ${durationDays} days\nObjective: ${objective}\nLocation: ${location || "Global"}\nAudience: ${audience || "All"}`,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          days: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                day: { type: Type.NUMBER },
                theme: { type: Type.STRING },
                title: { type: Type.STRING },
                body: { type: Type.STRING },
                recommendedTime: { type: Type.STRING },
                reasoning: { type: Type.STRING },
              },
              required: ["day", "theme", "title", "body", "recommendedTime", "reasoning"],
            },
          },
        },
        required: ["days"],
      },
    },
  });

  try {
    const parsed = JSON.parse(response.text || "{}");
    return generatePlanSchema.parse(parsed);
  } catch (err: any) {
    throw new HttpsError("internal", `Failed to parse AI response: ${err.message}`);
  }
});

export const translateNotificationContent = onCall({
  maxInstances: 2,
  secrets: [GEMINI_API_KEY],
}, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { content, sourceLanguage, targetLanguages } = request.data;
  if (!content || !targetLanguages || !Array.isArray(targetLanguages)) {
    throw new HttpsError("invalid-argument", "Missing required parameters");
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  const systemInstruction = `You are KADA's AI Translator.
Translate notification content with cultural awareness, preserving formatting like {{variables}} and emojis.
Do not provide literal translations if a cultural equivalent is better.
Return a JSON map of language code to translated content (string).`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Source Content: "${content}"\nSource Language: ${sourceLanguage || "English"}\nTarget Languages: ${targetLanguages.join(", ")}`,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
    },
  });

  try {
    const parsed = JSON.parse(response.text || "{}");
    return parsed;
  } catch (err: any) {
    throw new HttpsError("internal", `Failed to parse AI response: ${err.message}`);
  }
});
