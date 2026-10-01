import { Loader2, Brain } from "lucide-react";

export const AppLoading = () => (
  <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 blur-[120px] rounded-full animate-pulse" />
    <div className="relative z-10 flex flex-col items-center">
      <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-cyan-400/20 to-blue-500/20 flex items-center justify-center mb-8 border border-cyan-500/30 shadow-[0_0_40px_rgba(6,182,212,0.25)] animate-bounce glow-effect relative">
        <div className="absolute inset-0 rounded-2xl bg-cyan-500/10 blur-xl animate-pulse" />
        <Brain className="h-10 w-10 text-cyan-500 relative z-10" />
      </div>
      <div className="space-y-4 text-center">
        <h2 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-blue-500">Xevyte</h2>
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Initializing Workspace...</p>
        </div>
      </div>
    </div>
  </div>
);
