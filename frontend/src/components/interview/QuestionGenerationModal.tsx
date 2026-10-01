import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";

interface QuestionGenerationModalProps {
  open: boolean;
  jobRole?: string;
  creationMode?: "hybrid" | "jd" | "coding";
}

const STEPS = [
  "Analyzing job requirements & core competencies...",
  "Crafting tailored technical & behavioral questions...",
  "Calibrating difficulty levels & evaluation rubrics...",
  "Finalizing questions for your review...",
];

export const QuestionGenerationModal: React.FC<QuestionGenerationModalProps> = ({
  open,
  jobRole,
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(15);

  useEffect(() => {
    if (!open) {
      setActiveStep(0);
      setProgress(15);
      return;
    }

    // Step cycle: smoothly advance step every 2.4s
    const stepInterval = setInterval(() => {
      setActiveStep((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
    }, 2400);

    // Progress bar smooth interpolation
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev < 90) return prev + Math.random() * 8 + 4;
        if (prev < 96) return prev + 0.5;
        return 96;
      });
    }, 500);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Generating Questions"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full max-w-sm sm:max-w-md bg-card border border-border/80 rounded-2xl p-6 sm:p-7 shadow-xl shadow-primary/5 text-center"
          >
            {/* Minimalist AI Icon */}
            <div className="relative mx-auto w-12 h-12 mb-4 flex items-center justify-center">
              <div
                className="absolute inset-0 rounded-full bg-primary/15 animate-ping"
                style={{ animationDuration: "2.5s" }}
              />
              <div className="relative w-11 h-11 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
            </div>

            {/* Title */}
            <h3 className="text-lg font-semibold text-foreground tracking-tight">
              Generating Questions
            </h3>

            {jobRole && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px] mx-auto">
                for <span className="font-medium text-foreground">{jobRole}</span>
              </p>
            )}

            {/* Meaningful Dynamic Status Line */}
            <div className="h-9 mt-3 mb-2 flex items-center justify-center overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.p
                  key={activeStep}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="text-sm text-foreground/80 font-medium px-2"
                >
                  {STEPS[activeStep]}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* Subtle Step Dots */}
            <div className="flex items-center justify-center gap-1.5 mb-5">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === activeStep
                      ? "w-5 bg-primary"
                      : i < activeStep
                      ? "w-1.5 bg-primary/40"
                      : "w-1.5 bg-muted-foreground/20"
                  }`}
                />
              ))}
            </div>

            {/* Slim Animated Progress Line */}
            <div className="w-full bg-muted/80 h-1 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
                style={{ width: `${Math.min(progress, 96)}%` }}
              />
            </div>

            {/* Clean reassurance footer */}
            <p className="text-[11px] text-muted-foreground/80 mt-4">
              This usually takes just a few seconds
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default QuestionGenerationModal;
