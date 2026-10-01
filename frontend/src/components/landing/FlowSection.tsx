import { motion } from "framer-motion";
import { Settings, UserCheck, Bot, ClipboardCheck, BarChart3, FileText, Code2, ArrowRight } from "lucide-react";

const steps = [
  { icon: FileText, title: "Resume", desc: "Candidate uploads resume" },
  { icon: Bot, title: "AI Generates Questions", desc: "Dynamic assessments generated" },
  { icon: UserCheck, title: "Interview", desc: "AI Avatar conducts session" },
  { icon: ClipboardCheck, title: "Evaluation", desc: "Code & emotion assessed" },
  { icon: BarChart3, title: "Report", desc: "Data-driven hiring decision" },
];

export function FlowSection() {
  return (
    <section className="py-8 border-t border-border/30 bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-20 pointer-events-none" />
      <div className="container relative z-10 mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            End-to-End <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-[#06b6d4]">Interview Pipeline</span>
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            A fully automated, intelligent workflow from configuration to final hiring decision.
          </p>
        </motion.div>

        <div className="relative max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 md:gap-0">
          
          {/* Animated Connecting Line (Desktop) */}
          {/* Animated Connecting SVG Line (Desktop) */}
          <div className="hidden md:block absolute top-10 left-[5%] right-[5%] h-1 z-0">
            <svg width="100%" height="100%" preserveAspectRatio="none">
              <line 
                x1="0" y1="2" x2="100%" y2="2" 
                stroke="hsl(var(--primary))" 
                strokeWidth="2" 
                strokeDasharray="8 8" 
                className="opacity-20"
              />
              <line 
                x1="0" y1="2" x2="100%" y2="2" 
                stroke="#06b6d4" 
                strokeWidth="2" 
                strokeDasharray="8 8" 
                className="animate-[dash_20s_linear_infinite]"
              />
            </svg>
            {/* Moving light pulses */}
            <motion.div 
              className="absolute top-1/2 -translate-y-1/2 left-0 w-24 h-[2px] bg-gradient-to-r from-transparent via-[#06b6d4] to-transparent blur-[1px]"
              animate={{ left: ['-10%', '110%'] }}
              transition={{ duration: 4, ease: "linear", repeat: Infinity }}
            />
            <motion.div 
              className="absolute top-1/2 -translate-y-1/2 left-0 w-16 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent blur-[1px]"
              animate={{ left: ['-20%', '120%'] }}
              transition={{ duration: 3.5, ease: "linear", repeat: Infinity, delay: 1.5 }}
            />
          </div>

          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative flex flex-col items-center w-full md:w-auto z-10 group"
            >
              {/* Connector for Mobile */}
              {i !== 0 && (
                <div className="md:hidden h-8 w-px bg-border/50 my-2 relative overflow-hidden flex flex-col items-center">
                  <motion.div 
                    className="w-[2px] h-4 bg-gradient-to-b from-transparent via-[#06b6d4] to-transparent rounded-full"
                    animate={{ y: [-10, 30] }}
                    transition={{ duration: 1.5, ease: "linear", repeat: Infinity }}
                  />
                </div>
              )}

              {/* Icon Bubble */}
              <div className="flex h-20 w-20 items-center justify-center rounded-md bg-card border-2 border-border mb-4 shadow-sm group-hover:border-primary group-hover:shadow-primary/20 transition-all duration-300 relative">
                {/* Active pulse effect */}
                <div className="absolute inset-0 rounded-md bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity animate-pulse" />
                <step.icon className="h-8 w-8 text-primary group-hover:scale-110 transition-transform duration-300" />
                
                {/* Step number badge */}
                <div className="absolute -top-3 -right-3 bg-secondary text-secondary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-background shadow-sm">
                  STEP 0{i + 1}
                </div>
              </div>
              
              <h4 className="text-sm font-bold text-foreground mb-1 text-center">{step.title}</h4>
              <p className="text-xs text-muted-foreground text-center max-w-[120px]">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
