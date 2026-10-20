import React, { useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  RefreshCw,
  Zap,
  Globe,
  Clock,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { notificationService } from "@/services/notificationService";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { AiGenerationResult } from "@/types/notifications";

export default function AiStudioPage() {
  const [, setSearchParams] = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<AiGenerationResult[]>([]);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Advanced settings state
  const [objective, setObjective] = useState("increase_orders");
  const [tone, setTone] = useState("professional");
  const [language, setLanguage] = useState("auto");

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await notificationService.generateNotificationContent({
        prompt,
        objective,
        tone,
        language,
      });
      setResults(response.results || []);
      if (response.results.length > 0) {
        toast.success("Content generated successfully");
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate content. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col w-full h-full p-6 space-y-6">
      <AdminPageHeader
        title="AI Notification Studio"
        description="Craft intelligent, multi-channel campaigns instantly with KADA AI."
      />

      <Tabs defaultValue="generate" className="w-full flex-1 flex flex-col">
        <TabsList className="w-full max-w-md mx-auto grid grid-cols-3">
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="planner">Campaign Planner</TabsTrigger>
          <TabsTrigger value="audit">AI Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="flex-1 mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            {/* LEFT PANEL: Input */}
            <Card className="flex flex-col border-purple-100 shadow-sm">
              <div className="p-6 flex-1 flex flex-col space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded bg-purple-100 flex items-center justify-center text-purple-600 dark:bg-purple-500/15">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-semibold">
                    What do you want to communicate?
                  </h2>
                </div>

                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., Create a weekend food festival campaign for customers in Kakkanad offering 20% off on all biryanis."
                  className="flex-1 min-h-[200px] resize-none text-base p-4 focus-visible:ring-purple-500"
                />

                <Collapsible
                  open={isAdvancedOpen}
                  onOpenChange={setIsAdvancedOpen}
                  className="border rounded-md"
                >
                  <CollapsibleTrigger className="flex w-full items-center justify-between p-4 font-medium hover:bg-muted/50">
                    Advanced Controls
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${isAdvancedOpen ? "rotate-180" : ""}`}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="p-4 pt-0 space-y-4 border-t mt-2">
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Objective</label>
                        <Select value={objective} onValueChange={setObjective}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="increase_orders">
                              Increase Orders
                            </SelectItem>
                            <SelectItem value="reactivate">
                              Reactivate Users
                            </SelectItem>
                            <SelectItem value="promote">
                              Promote Feature
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Tone</label>
                        <Select value={tone} onValueChange={setTone}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="professional">
                              Professional
                            </SelectItem>
                            <SelectItem value="friendly">
                              Friendly & Casual
                            </SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                            <SelectItem value="local">Local Flavor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Language</label>
                        <Select value={language} onValueChange={setLanguage}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">
                              Auto-detect from prompt
                            </SelectItem>
                            <SelectItem value="en">English</SelectItem>
                            <SelectItem value="ml">Malayalam</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Button
                  size="lg"
                  className="w-full h-14 text-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 mt-auto"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="mr-2 h-5 w-5 animate-spin" />{" "}
                      Generating Magic...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" /> Generate with AI
                    </>
                  )}
                </Button>
              </div>
            </Card>

            {/* RIGHT PANEL: Output */}
            <div className="flex flex-col bg-muted/50 rounded-xl border border-border p-6 overflow-y-auto">
              {isGenerating ? (
                <div className="h-full flex flex-col items-center justify-center space-y-6 text-purple-600">
                  <div className="relative">
                    <div className="absolute inset-0 animate-ping rounded-full bg-purple-200 opacity-75"></div>
                    <Sparkles className="relative h-12 w-12 animate-pulse" />
                  </div>
                  <p className="font-medium text-lg animate-pulse">
                    Analyzing audience and crafting content...
                  </p>
                </div>
              ) : results.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center space-y-4 max-w-sm mx-auto">
                  <div className="h-20 w-20 bg-purple-50 rounded-full flex items-center justify-center mb-2 dark:bg-purple-500/10">
                    <Zap className="h-10 w-10 text-purple-300" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">
                    Awaiting Instructions
                  </h3>
                  <p>
                    Describe your campaign on the left, and KADA AI will
                    generate optimized, multi-channel notifications tailored for
                    your audience.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg">Generated Options</h3>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleGenerate}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Regenerate All
                      </Button>

                    </div>
                  </div>

                  {results.map((result, i) => (
                    <Card
                      key={i}
                      className="overflow-hidden border-purple-100 shadow-md"
                    >
                      <div className="bg-purple-50 px-4 py-2 flex items-center justify-between border-b border-purple-100 dark:bg-purple-500/10 dark:border-purple-500/30">
                        <div className="flex gap-2">
                          <Badge className="bg-purple-600">
                            {result.targetApp}
                          </Badge>
                          <Badge variant="outline" className="bg-card">
                            {result.audience}
                          </Badge>
                        </div>
                        <div className="flex gap-2 text-muted-foreground">
                          {result.channels.includes("push") && (
                            <Badge
                              variant="secondary"
                              className="text-xs bg-card"
                            >
                              <MessageSquare className="w-3 h-3 mr-1" />
                              Push
                            </Badge>
                          )}
                          <Badge
                            variant="secondary"
                            className="text-xs bg-card"
                          >
                            <Globe className="w-3 h-3 mr-1" />
                            {result.language}
                          </Badge>
                        </div>
                      </div>
                      <CardContent className="p-4 space-y-4">
                        <div>
                          <div className="flex items-center justify-between group">
                            <h4 className="font-bold text-lg">
                              {result.title}
                            </h4>

                          </div>
                          <div className="flex items-center justify-between group mt-1">
                            <p className="text-foreground/90">{result.body}</p>

                          </div>
                        </div>

                        <div className="bg-muted/50 p-3 rounded-lg text-sm border flex items-start gap-3">
                          <Clock className="h-5 w-5 text-purple-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold block">
                              Recommended Time: {result.recommendedTime}
                            </span>
                            <span className="text-muted-foreground">
                              {result.reasoning}
                            </span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2">
                          <div className="text-xs text-muted-foreground">
                            Est. Reach:{" "}
                            {result.audienceSize
                              ? result.audienceSize.toLocaleString("en-IN")
                              : "—"}{" "}
                            users
                          </div>
                          <div className="flex gap-2">

                            <Button
                              size="sm"
                              onClick={() => {
                                setSearchParams((prev) => {
                                  const next = new URLSearchParams(prev);
                                  next.set("tab", "notifications");
                                  next.set("section", "send");
                                  next.set("draftTitle", result.title);
                                  next.set("draftBody", result.body);
                                  return next;
                                });
                                toast.success("Opened in Send");
                              }}
                            >
                              Send this
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="planner">
          <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-card mt-6 h-[400px]">
            <Sparkles className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium">Campaign Planner</h3>
            <p className="text-muted-foreground max-w-md mt-2">
              The AI Campaign Planner can automatically design a multi-day
              notification strategy based on your goal.
            </p>

          </div>
        </TabsContent>

        <TabsContent value="audit">
          <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-card mt-6 h-[400px]">
            <h3 className="text-lg font-medium">AI Audit Logs</h3>
            <p className="text-muted-foreground mt-2">
              Monitor all AI-generated content and validation results for
              compliance and safety.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
