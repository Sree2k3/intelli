import React, { useEffect, useState } from "react";
import { Code2, Lightbulb, MessageSquare, Plus, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface QuestionSkeletonLoaderProps {
  creationMode?: "hybrid" | "jd" | "coding";
  jobRole?: string;
}

const GENERATING_STAGES = [
  "Analyzing job requirements & technical prerequisites...",
  "Formulating scenario challenges & practical problem sets...",
  "Calibrating difficulty levels & evaluation benchmarks...",
  "Structuring question workbench for recruiter review...",
];

export const QuestionSkeletonLoader: React.FC<QuestionSkeletonLoaderProps> = ({
  creationMode = "hybrid",
  jobRole,
}) => {
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(18);

  useEffect(() => {
    const stageInterval = setInterval(() => {
      setStageIndex((prev) => (prev < GENERATING_STAGES.length - 1 ? prev + 1 : prev));
    }, 2400);

    const progInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev < 86) return prev + Math.random() * 5 + 3;
        if (prev < 95) return prev + 0.4;
        return 95;
      });
    }, 350);

    return () => {
      clearInterval(stageInterval);
      clearInterval(progInterval);
    };
  }, []);

  const categories = [
    ...(creationMode !== "coding"
      ? [
          {
            key: "technical",
            label: "Technical Questions",
            icon: Lightbulb,
            color: "bg-primary/10 text-primary",
            count: 3,
            expectedText: "Preparing ~3 domain-specific questions...",
          },
        ]
      : []),
    ...(creationMode !== "jd"
      ? [
          {
            key: "coding",
            label: "Coding Questions",
            icon: Code2,
            color: "bg-accent/10 text-accent",
            count: 1,
            expectedText: "Structuring algorithmic challenge & test cases...",
          },
        ]
      : []),
    ...(creationMode !== "coding"
      ? [
          {
            key: "behavioral",
            label: "Behavioral Questions",
            icon: MessageSquare,
            color: "bg-success/10 text-success",
            count: 2,
            expectedText: "Curating ~2 situational & leadership questions...",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Enterprise Processing Header */}
      <div className="relative overflow-hidden rounded-md border border-border/50 bg-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left Text Block */}
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground tracking-tight">
                Generating Questions
              </h3>
              {jobRole && (
                <span className="text-xs text-muted-foreground truncate max-w-[280px]">
                  for <span className="font-medium text-foreground">{jobRole}</span>
                </span>
              )}
            </div>

            {/* Subtitle with dynamic stage */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 font-medium text-primary shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Step {stageIndex + 1} of 4
              </span>
              <span className="text-border">|</span>
              <div className="h-4 overflow-hidden flex items-center">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={stageIndex}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.2 }}
                    className="truncate"
                  >
                    {GENERATING_STAGES[stageIndex]}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right Progress Readout */}
          <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
            <div className="flex items-center gap-2 text-xs font-mono bg-secondary/30 border border-border/40 px-3 py-1.5 rounded-md">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
              <span className="font-semibold text-foreground">{Math.round(progress)}%</span>
              <span className="text-muted-foreground font-sans">Processing</span>
            </div>
          </div>
        </div>

        {/* Integrated Hairline Progress Line */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-muted/60 overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            style={{ width: `${Math.min(progress, 96)}%` }}
            transition={{ ease: "easeOut", duration: 0.3 }}
          />
        </div>
      </div>

      {/* Categorized Question Skeletons */}
      {categories.map((cat) => {
        const Icon = cat.icon;
        const isCoding = cat.key === "coding";

        return (
          <div
            key={cat.key}
            className="card-elevated rounded-md border border-border/50 overflow-hidden transition-all"
          >
            {/* Category Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-secondary/10">
              <div className="flex items-center gap-3">
                <div className={`h-8 w-8 rounded-md flex items-center justify-center ${cat.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold capitalize text-foreground">
                    {cat.label}
                  </h3>
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-pulse" />
                    {cat.expectedText}
                  </span>
                </div>
              </div>

              {/* Disabled Action Buttons */}
              <div className="flex items-center gap-2 opacity-50">
                <button
                  disabled
                  className="h-8 px-3 text-xs rounded-md border border-border/60 bg-background flex items-center gap-1 cursor-not-allowed font-medium text-muted-foreground"
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
                <button
                  disabled
                  className="h-8 px-3 text-xs rounded-md bg-transparent flex items-center gap-1 cursor-not-allowed font-medium text-muted-foreground"
                >
                  Select All
                </button>
              </div>
            </div>

            {/* Question Rows */}
            <div className="divide-y divide-border/30">
              {Array.from({ length: cat.count }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-5 py-4 bg-background/50 hover:bg-muted/10 transition-colors"
                >
                  {/* Checkbox Placeholder */}
                  <div className="mt-0.5 h-5 w-5 rounded border-2 border-slate-300 dark:border-slate-700 bg-muted/40 shrink-0" />

                  {/* Question Content */}
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Title Lines */}
                    <div className="space-y-1.5">
                      <div
                        className="h-4 bg-muted/80 rounded animate-shimmer-sweep"
                        style={{
                          width: isCoding ? "65%" : i % 2 === 0 ? "82%" : "90%",
                        }}
                      />
                      <div
                        className="h-3.5 bg-muted/50 rounded animate-shimmer-sweep"
                        style={{
                          width: isCoding ? "88%" : i % 2 === 0 ? "55%" : "68%",
                        }}
                      />
                    </div>

                    {/* For coding problems: show a simulated test case badge */}
                    {isCoding && (
                      <div className="mt-2.5 p-2 rounded-md bg-secondary/30 border border-border/40 space-y-1.5 max-w-md">
                        <div className="h-3 bg-muted/60 rounded w-1/3 animate-shimmer-sweep" />
                        <div className="h-2.5 bg-muted/40 rounded w-3/4 animate-shimmer-sweep font-mono" />
                      </div>
                    )}

                    {/* Metadata Badges */}
                    <div className="flex items-center gap-2 pt-1">
                      {/* Difficulty Badge Placeholder */}
                      <div className="h-4 w-14 rounded-full bg-muted/70 animate-shimmer-sweep" />
                      {/* AI Badge Placeholder */}
                      <div className="h-3.5 w-10 rounded-full bg-muted/50 animate-shimmer-sweep" />
                    </div>
                  </div>

                  {/* Actions Placeholder (edit/delete) */}
                  <div className="flex items-center gap-1 shrink-0 opacity-40">
                    <div className="w-7 h-7 rounded-md bg-muted/50 animate-shimmer-sweep" />
                    <div className="w-7 h-7 rounded-md bg-muted/50 animate-shimmer-sweep" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default QuestionSkeletonLoader;
