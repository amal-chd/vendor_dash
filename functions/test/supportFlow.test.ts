import { describe, it, expect } from "vitest";
import {
  cleanSuggestedActions,
  inferRole,
  messagePreview,
  parseModelJson,
  planForUserMessage,
  wantsHuman,
} from "../src/supportFlow";

describe("planForUserMessage", () => {
  it("lets the AI answer a chat it is handling", () => {
    expect(planForUserMessage("bot")).toEqual({ kind: "ai", reopen: false, waitingForHuman: false });
    expect(planForUserMessage(undefined)).toEqual({ kind: "ai", reopen: false, waitingForHuman: false });
  });

  it("reopens resolved and legacy disconnected chats instead of dropping the message", () => {
    expect(planForUserMessage("resolved")).toEqual({ kind: "ai", reopen: true, waitingForHuman: false });
    expect(planForUserMessage("disconnected")).toEqual({ kind: "ai", reopen: true, waitingForHuman: false });
  });

  it("keeps answering while a chat waits for a human", () => {
    expect(planForUserMessage("escalated")).toEqual({ kind: "ai", reopen: false, waitingForHuman: true });
  });

  it("stays out of a chat a person is handling", () => {
    expect(planForUserMessage("open")).toEqual({ kind: "human" });
  });
});

describe("wantsHuman", () => {
  it.each([
    "Talk to a human",
    "talk to human",
    "agent",
    "Customer care",
    "I want to talk to a person",
    "can i speak with an agent?",
    "connect me to support",
    "please talk to someone",
  ])("recognises %s", (t) => expect(wantsHuman(t)).toBe(true));

  it.each(["where is my order", "my agent code is wrong", "", "humanity", "talk later"])(
    "ignores %s",
    (t) => expect(wantsHuman(t)).toBe(false),
  );
});

describe("parseModelJson", () => {
  it("parses plain and fenced JSON", () => {
    expect(parseModelJson('{"reply":"hi"}')).toEqual({ reply: "hi" });
    expect(parseModelJson('```json\n{"reply":"hi"}\n```')).toEqual({ reply: "hi" });
    expect(parseModelJson('Sure! {"reply":"hi"} hope that helps')).toEqual({ reply: "hi" });
    expect(parseModelJson('["a","b"]')).toEqual(["a", "b"]);
  });

  it("returns null for anything else", () => {
    expect(parseModelJson("")).toBeNull();
    expect(parseModelJson(undefined)).toBeNull();
    expect(parseModelJson("no json here")).toBeNull();
  });
});

describe("messagePreview", () => {
  it("prefers text and labels attachments", () => {
    expect(messagePreview({ text: "  hello " })).toBe("hello");
    expect(messagePreview({ imageUrl: "x" })).toBe("📷 Image attached");
    expect(messagePreview({ mediaType: "voice", mediaUrl: "x" })).toBe("🎤 Voice note");
    expect(messagePreview({})).toBe("Attachment");
    expect(messagePreview({ text: "a".repeat(400) })).toHaveLength(298);
  });
});

describe("cleanSuggestedActions", () => {
  it("keeps up to four distinct short strings", () => {
    expect(cleanSuggestedActions(["A", "A", 3, " B ", "", "C", "D", "E"])).toEqual(["A", "B", "C", "D"]);
    expect(cleanSuggestedActions("nope")).toEqual([]);
  });
});

describe("inferRole", () => {
  it("picks the profile the uid owns", () => {
    expect(inferRole({ restaurant: true, rider: false, hotel: false })).toBe("vendor");
    expect(inferRole({ restaurant: false, rider: true, hotel: false })).toBe("rider");
    expect(inferRole({ restaurant: false, rider: false, hotel: true })).toBe("host");
    expect(inferRole({ restaurant: false, rider: false, hotel: false })).toBe("customer");
  });
});
