import { motion } from "framer-motion";
import {
  Brain,
  Code2,
  Eye,
  BarChart3,
  Shield,
  Mic,
  MessageSquare,
  Zap,
  Users,
  TrendingUp,
} from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "AI Interview Brain",
    desc: "Dynamic question selection with context-aware follow-ups and adaptive difficulty across tech, HR, and managerial rounds.",
  },
  {
    icon: Mic,
    title: "Voice & Video",
    desc: "Real-time speech recognition, text-to-speech, and optional video recording for comprehensive assessment.",
  },
  {
    icon: Eye,
    title: "Emotion Intelligence",
    desc: "Facial emotion detection, voice tone analysis, and sentiment scoring to evaluate soft skills beyond words.",
  },
  {
    icon: Code2,
    title: "Code Evaluation",
    desc: "Multi-language code editor with auto-compilation, test case validation, and AI-powered code quality analysis.",
  },
  {
    icon: BarChart3,
    title: "Scoring Engine",
    desc: "Weighted scoring across technical, coding, problem-solving, communication, and behavioral dimensions.",
  },
  {
    icon: Shield,
    title: "Proctoring Suite",
    desc: "Tab switch monitoring, face detection, voice detection, and browser lock mode for interview integrity.",
  },
  {
    icon: TrendingUp,
    title: "Learning Engine",
    desc: "Continuous improvement through recruiter feedback loops, hiring outcome tracking, and model fine-tuning.",
  },
  {
    icon: Users,
    title: "Enterprise Dashboard",
    desc: "Role-based access for recruiters, hiring managers, and admins with comprehensive analytics and reporting.",
  },
  {
    icon: Zap,
    title: "Real-time Analytics",
    desc: "Live interview monitoring, engagement heatmaps, and instant report generation with hiring recommendations.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="relative py-24">
      <div className="absolute inset-0 bg-grid opacity-20" />
      <div className="container relative z-10 mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Intelligent Modules.{" "}
            <span className="gradient-text">One Platform.</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Every component designed to evaluate candidates with human-level
            intelligence and machine-level precision.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="group card-elevated rounded-md border border-border/50 p-6 hover:border-primary/30 transition-all duration-300"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary mb-4 group-hover:glow-effect transition-all">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold mb-2 text-foreground">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
