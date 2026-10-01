import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Video, Brain, Code2, Mic, Activity, Shield, ChartBar, Cpu } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

export function HeroSection() {
  return (
    <section className="relative min-h-screen pt-20 pb-8 overflow-hidden bg-background flex flex-col justify-center">
      {/* Dynamic Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--primary))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--primary))_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.03]" />
      
      {/* Soft Glow Regions */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/10 blur-[120px] animate-pulse" style={{ animationDuration: '4s' }} />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/4 w-[500px] h-[500px] rounded-full bg-cyan-500/10 blur-[120px] animate-pulse" style={{ animationDuration: '6s' }} />

      <div className="container relative z-10 mx-auto px-4 text-center">
        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold text-primary mb-6 shadow-sm"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Enterprise-Grade Intelligence
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] text-foreground mb-6 max-w-5xl mx-auto"
        >
          Automate Interviews with <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#0ea5e9] to-[#06b6d4]">
            Human-Level Precision
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto max-w-2xl text-lg text-muted-foreground mb-10 leading-relaxed"
        >
          Deploy our intelligent operating system to conduct technical & behavioral assessments, analyze micro-expressions, and make data-driven hiring decisions instantly.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <Link to="/interview">
            <button className="w-full sm:w-auto bg-primary text-primary-foreground rounded-md px-8 py-4 font-bold hover:brightness-110 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/25 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 group">
              <Video className="w-5 h-5 group-hover:rotate-12 transition-transform" />
              <span>Create Interview</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </Link>
          <Link to="/dashboard">
            <button className="w-full sm:w-auto bg-card text-card-foreground border border-border rounded-md px-8 py-4 font-bold hover:bg-accent/5 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg active:scale-95 transition-all duration-300">
              View Dashboard
            </button>
          </Link>
        </motion.div>

        {/* --- AI Engine Visualization --- */}
        <div className="text-center mb-10 mt-24 relative z-20">
          <h2 className="text-3xl font-extrabold text-foreground tracking-tight">AI Intelligence Network</h2>
          <p className="text-muted-foreground mt-3 text-sm md:text-base max-w-2xl mx-auto">
            Real-time multimodal candidate evaluation powered by voice, emotion, coding, and integrity analysis.
          </p>
        </div>

        {/* AI Core Visualization Section */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="relative w-full max-w-5xl mx-auto mt-8"
        >
          {/* Desktop Enterprise Grid */}
          <div className="hidden md:flex flex-col relative w-[1000px] h-[600px] mx-auto">
            {/* SVG Data Flow Curves */}
            <svg className="absolute inset-0 w-full h-full z-10 pointer-events-none" viewBox="0 0 1000 600">
              <defs>
                <linearGradient id="gradTL" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.2" />
                </linearGradient>
                <linearGradient id="gradTR" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.2" />
                </linearGradient>
                <linearGradient id="gradBL" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.2" />
                </linearGradient>
                <linearGradient id="gradBR" x1="100%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.2" />
                </linearGradient>
                <linearGradient id="gradOut" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Smooth Cubic Bezier Data Pipelines */}
              <path d="M 292 136 C 340 136, 340 183, 377 183" stroke="url(#gradTL)" strokeWidth="3" fill="none" className="opacity-80" />
              <path d="M 708 136 C 660 136, 660 183, 623 183" stroke="url(#gradTR)" strokeWidth="3" fill="none" className="opacity-80" />
              <path d="M 292 364 C 340 364, 340 317, 377 317" stroke="url(#gradBL)" strokeWidth="3" fill="none" className="opacity-80" />
              <path d="M 708 364 C 660 364, 660 317, 623 317" stroke="url(#gradBR)" strokeWidth="3" fill="none" className="opacity-80" />
              <path d="M 500 381 L 500 498" stroke="url(#gradOut)" strokeWidth="4" fill="none" className="opacity-90" />

              {/* Connection Terminals (Nodes) */}
              <circle cx="292" cy="136" r="4" fill="#06b6d4" filter="url(#glow)" />
              <circle cx="708" cy="136" r="4" fill="#38bdf8" filter="url(#glow)" />
              <circle cx="292" cy="364" r="4" fill="#0ea5e9" filter="url(#glow)" />
              <circle cx="708" cy="364" r="4" fill="#06b6d4" filter="url(#glow)" />
              
              {/* Engine Terminals */}
              <circle cx="377" cy="183" r="4" fill="#0ea5e9" />
              <circle cx="623" cy="183" r="4" fill="#0ea5e9" />
              <circle cx="377" cy="317" r="4" fill="#0ea5e9" />
              <circle cx="623" cy="317" r="4" fill="#0ea5e9" />
              <circle cx="500" cy="381" r="4" fill="#0ea5e9" />
              <circle cx="500" cy="498" r="5" fill="#06b6d4" filter="url(#glow)" />

              {/* Flow Animations */}
              <circle r="4" fill="#06b6d4" filter="url(#glow)">
                <animateMotion dur="2s" repeatCount="indefinite" path="M 292 136 C 340 136, 340 183, 377 183" />
              </circle>
              <circle r="3" fill="#ffffff" filter="url(#glow)">
                <animateMotion dur="2s" begin="1s" repeatCount="indefinite" path="M 292 136 C 340 136, 340 183, 377 183" />
              </circle>

              <circle r="4" fill="#38bdf8" filter="url(#glow)">
                <animateMotion dur="2s" begin="0.5s" repeatCount="indefinite" path="M 708 136 C 660 136, 660 183, 623 183" />
              </circle>
              <circle r="3" fill="#ffffff" filter="url(#glow)">
                <animateMotion dur="2s" begin="1.5s" repeatCount="indefinite" path="M 708 136 C 660 136, 660 183, 623 183" />
              </circle>

              <circle r="4" fill="#0ea5e9" filter="url(#glow)">
                <animateMotion dur="2s" begin="0.2s" repeatCount="indefinite" path="M 292 364 C 340 364, 340 317, 377 317" />
              </circle>
              <circle r="3" fill="#ffffff" filter="url(#glow)">
                <animateMotion dur="2s" begin="1.2s" repeatCount="indefinite" path="M 292 364 C 340 364, 340 317, 377 317" />
              </circle>

              <circle r="4" fill="#06b6d4" filter="url(#glow)">
                <animateMotion dur="2s" begin="0.7s" repeatCount="indefinite" path="M 708 364 C 660 364, 660 317, 623 317" />
              </circle>
              <circle r="3" fill="#ffffff" filter="url(#glow)">
                <animateMotion dur="2s" begin="1.7s" repeatCount="indefinite" path="M 708 364 C 660 364, 660 317, 623 317" />
              </circle>

              <circle r="5" fill="#06b6d4" filter="url(#glow)">
                <animateMotion dur="1.5s" repeatCount="indefinite" path="M 500 381 L 500 498" />
              </circle>
              <circle r="3" fill="#ffffff" filter="url(#glow)">
                <animateMotion dur="1.5s" begin="0.75s" repeatCount="indefinite" path="M 500 381 L 500 498" />
              </circle>
            </svg>

            {/* Architecture Grid Layer */}
            <div className="flex justify-between items-center w-full flex-1 relative z-20 px-[32px]">
              {/* Left Column (Inputs) */}
              <div className="flex flex-col gap-[138px]">
                <FeatureCard 
                  icon={Mic} 
                  title="Voice Analysis" 
                  desc="Real-time speech & tone evaluation"
                  color="text-[#06b6d4]"
                  bg="bg-[#06b6d4]/10"
                  delay={0.1}
                />
                <FeatureCard 
                  icon={Code2} 
                  title="Code Assessment" 
                  desc="Live syntax & logic validation"
                  color="text-[#0ea5e9]"
                  bg="bg-[#0ea5e9]/10"
                  delay={0.5}
                />
              </div>

              {/* Center Column (AI Engine) */}
              <div className="flex-1 flex justify-center relative -top-[16px]">
                {/* Central AI Engine */}
                <div className="relative w-64 h-64 flex items-center justify-center">
                  <div className="absolute inset-4 bg-[#06b6d4]/10 rounded-full blur-xl animate-pulse" style={{ animationDuration: '3s' }} />
                  
                  <div className="absolute inset-[-5px] rounded-full border border-dashed border-[#06b6d4]/40 animate-[spin_20s_linear_infinite]" />
                  <div className="absolute inset-[-20px] rounded-full border border-[#06b6d4]/20" />
                  <div className="absolute inset-[-20px] rounded-full border-t-2 border-r-2 border-[#06b6d4]/60 animate-[spin_15s_linear_infinite_reverse]" />
                  <div className="absolute inset-[-35px] rounded-full border border-primary/15" />
                  <div className="absolute inset-[-35px] rounded-full border-b-2 border-l-2 border-primary/40 animate-[spin_25s_linear_infinite]" />
                  
                  <div className="relative w-44 h-44 bg-card rounded-full shadow-[0_0_30px_rgba(6,182,212,0.15)] border border-[#06b6d4]/30 flex flex-col items-center justify-center z-10 overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#06b6d4]/5 to-primary/5" />
                    <Brain className="w-16 h-16 text-[#06b6d4] drop-shadow-[0_0_8px_rgba(6,182,212,0.5)] group-hover:scale-110 transition-transform duration-500" />
                    <span className="text-[10px] font-bold text-foreground mt-2 uppercase tracking-widest opacity-90">AI Engine</span>
                  </div>
                </div>
              </div>

              {/* Right Column (Inputs) */}
              <div className="flex flex-col gap-[138px]">
                <FeatureCard 
                  icon={Activity} 
                  title="Emotion Detection" 
                  desc="Micro-expression & sentiment scoring"
                  color="text-[#38bdf8]"
                  bg="bg-[#38bdf8]/10"
                  delay={0.3}
                />
                <FeatureCard 
                  icon={Shield} 
                  title="AI Proctoring" 
                  desc="Continuous integrity monitoring"
                  color="text-[#06b6d4]"
                  bg="bg-[#06b6d4]/10"
                  delay={0.7}
                />
              </div>
            </div>

            {/* Output Node */}
            <div className="absolute bottom-[32px] left-1/2 -translate-x-1/2 z-20">
              <motion.div 
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <div className="w-[260px] p-4 rounded-md border border-primary/30 bg-card/90 backdrop-blur-2xl shadow-[0_8px_32px_rgba(31,111,235,0.15)] flex items-center justify-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-[#06b6d4]/10 flex items-center justify-center">
                    <ChartBar className="w-4 h-4 text-[#06b6d4]" />
                  </div>
                  <div className="text-left">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">Final Output</div>
                    <div className="text-sm font-extrabold text-foreground tracking-tight">Hiring Recommendation</div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          {/* Mobile Fallback Layout */}
          <div className="flex flex-col md:hidden items-center gap-12 px-4 relative z-20 mt-8 mb-16">
            {/* Mobile Engine */}
            <div className="relative w-48 h-48 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-dashed border-[#06b6d4]/40 animate-[spin_20s_linear_infinite]" />
              <div className="absolute inset-[-15px] rounded-full border border-primary/15" />
              <div className="relative w-32 h-32 bg-card rounded-full shadow-[0_0_30px_rgba(6,182,212,0.15)] border border-[#06b6d4]/30 flex flex-col items-center justify-center z-10 overflow-hidden">
                <Brain className="w-12 h-12 text-[#06b6d4]" />
                <span className="text-[9px] font-bold text-foreground mt-2 uppercase tracking-widest opacity-90">AI Engine</span>
              </div>
            </div>

            {/* Mobile Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
              <FeatureCard icon={Mic} title="Voice Analysis" desc="Real-time speech & tone evaluation" color="text-[#06b6d4]" bg="bg-[#06b6d4]/10" delay={0.1} />
              <FeatureCard icon={Activity} title="Emotion Detection" desc="Micro-expression & sentiment scoring" color="text-[#38bdf8]" bg="bg-[#38bdf8]/10" delay={0.2} />
              <FeatureCard icon={Code2} title="Code Assessment" desc="Live syntax & logic validation" color="text-[#0ea5e9]" bg="bg-[#0ea5e9]/10" delay={0.3} />
              <FeatureCard icon={Shield} title="AI Proctoring" desc="Continuous integrity monitoring" color="text-[#06b6d4]" bg="bg-[#06b6d4]/10" delay={0.4} />
            </div>

            {/* Mobile Output */}
            <div className="w-full max-w-sm p-4 rounded-md border border-primary/30 bg-card shadow-lg flex items-center justify-center gap-3">
              <div className="h-8 w-8 rounded-full bg-[#06b6d4]/10 flex items-center justify-center">
                <ChartBar className="w-4 h-4 text-[#06b6d4]" />
              </div>
              <div className="text-left">
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">Final Output</div>
                <div className="text-sm font-extrabold text-foreground tracking-tight">Hiring Recommendation</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-5xl mx-auto"
        >
          <StatCard value="50,000+" label="Interviews Conducted" color="group-hover:border-primary group-hover:shadow-primary/10" />
          <StatCard value="<2s" label="AI Response Time" color="group-hover:border-secondary group-hover:shadow-secondary/10" />
          <StatCard value="99%" label="Uptime SLA" color="group-hover:border-accent group-hover:shadow-accent/10" />
          <StatCard value="95%" label="Hiring Accuracy" color="group-hover:border-primary group-hover:shadow-primary/10" />
        </motion.div>
      </div>
    </section>
  );
}

const FeatureCard = ({ icon: Icon, title, desc, color, bg, delay }: any) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className="w-[260px] group relative"
    >
      <motion.div 
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: delay }}
        className="relative bg-card/60 backdrop-blur-2xl p-4 rounded-md border border-white/10 shadow-[0_4px_24px_rgba(0,0,0,0.05)] hover:border-[#06b6d4]/30 hover:shadow-[0_8px_32px_rgba(6,182,212,0.15)] transition-all duration-300 flex items-start gap-4 overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50 pointer-events-none" />
        
        <div className={`p-3 rounded-md ${bg} bg-gradient-to-br from-white/10 to-transparent border border-white/10 shadow-inner group-hover:scale-110 transition-transform duration-300 relative z-10`}>
          <Icon className={`w-6 h-6 ${color}`} />
        </div>
        <div className="relative z-10">
          <h3 className="font-semibold text-foreground text-sm mb-1">{title}</h3>
          <p className="text-muted-foreground text-[12px] leading-relaxed">{desc}</p>
        </div>
      </motion.div>
    </motion.div>
  );
};

function StatCard({ value, label, color }: { value: string, label: string, color: string }) {
  return (
    <div className={`group bg-card p-6 rounded-md border border-border transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-default ${color}`}>
      <div className="text-3xl md:text-4xl font-extrabold text-foreground mb-2">{value}</div>
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
    </div>
  );
}
