import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface VoiceVisualizerProps {
  isSpeaking: boolean;
  isListening: boolean;
  isThinking: boolean;
  isTranscribing: boolean;
  volume: number;
  onSkip?: () => void;
}

const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({ 
  isSpeaking, 
  isListening,
  isThinking,
  isTranscribing,
  volume, 
  onSkip 
}) => {
  // Generate 32 bars for a high-density waveform with perspective effect
  const totalBars = 32;
  const center = (totalBars - 1) / 2;
  
  const bars = Array.from({ length: totalBars }).map((_, i) => {
    // Distance from center (0 = center, 1 = edge)
    const distFromCenter = Math.abs(i - center) / center;
    // Bell curve: center bars taller, edges shorter
    const heightMultiplier = Math.cos(distFromCenter * Math.PI * 0.5);
    
    return {
      delay: i * 0.03,
      heightMultiplier,
      distFromCenter,
    };
  });

  const isActive = isSpeaking || isListening;

  // Color stops for gradient across bars
  const getBarColor = (index: number) => {
    if (isSpeaking) {
      // Cyan to blue gradient
      const ratio = index / totalBars;
      if (ratio < 0.3) return 'bg-cyan-500 dark:bg-cyan-400';
      if (ratio < 0.6) return 'bg-cyan-600 dark:bg-cyan-500';
      return 'bg-blue-600 dark:bg-blue-500';
    }
    if (isListening) {
      // Emerald to teal gradient
      const ratio = index / totalBars;
      if (ratio < 0.3) return 'bg-emerald-500 dark:bg-emerald-400';
      if (ratio < 0.6) return 'bg-emerald-600 dark:bg-emerald-500';
      return 'bg-teal-600 dark:bg-teal-500';
    }
    if (isThinking) return 'bg-amber-500 dark:bg-amber-400';
    return 'bg-slate-400 dark:bg-slate-500';
  };

  return (
    <div className="flex items-center justify-center relative w-full h-full">
      {/* Central Visualizer Engine */}
      <div className="relative w-full h-full flex items-center justify-center">
        
        {/* Active State Glow Layers */}
        <AnimatePresence>
          {isActive && (
            <>
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 0.2, scale: 1.1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ duration: 2, repeat: Infinity, repeatType: "mirror" }}
                className={`absolute inset-0 rounded-full blur-[60px] ${
                  isSpeaking ? 'bg-cyan-400/20' : 'bg-emerald-400/20'
                }`}
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 0.1, scale: 1.3 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 3, repeat: Infinity, repeatType: "mirror", delay: 0.5 }}
                className={`absolute inset-0 rounded-full blur-[80px] ${
                  isSpeaking ? 'bg-blue-500/15' : 'bg-teal-500/15'
                }`}
              />
            </>
          )}
        </AnimatePresence>

        {/* Waveform Visualization */}
        <div className="flex flex-col items-center gap-0 relative z-10">
          {/* Main bars */}
          <div className="flex items-center gap-[2px] px-4 h-20 md:h-24">
            {bars.map((bar, i) => {
              const maxAnimHeight = Math.max(15, bar.heightMultiplier * 100);
              
              return (
                <motion.div
                  key={i}
                  initial={{ scaleY: 0.08 }}
                  animate={{ 
                    scaleY: isActive
                    ? [
                      bar.heightMultiplier * 0.15,
                      Math.min(maxAnimHeight / 100, Math.max(0.12, bar.heightMultiplier * 2.5 * volume + (Math.random() * 0.15))),
                      bar.heightMultiplier * 0.18
                    ] 
                    : isThinking 
                      ? [ 0.1, 0.2 + bar.heightMultiplier * 0.25, 0.1 ]
                      : 0.08 + bar.heightMultiplier * 0.04,
                    opacity: isActive ? [0.7, 1, 0.7] : isThinking ? [0.3, 0.6, 0.3] : 0.2
                  }}
                  transition={{ 
                    duration: isThinking ? 1 : 0.35, 
                    repeat: Infinity, 
                    ease: "easeInOut",
                    delay: bar.delay 
                  }}
                  className={`rounded-full transition-colors duration-500 h-full origin-center ${getBarColor(i)}`}
                  style={{
                    width: `${Math.max(3, 5 - bar.distFromCenter * 2)}px`,
                    willChange: "transform, opacity",
                  }}
                />
              );
            })}
          </div>
          
          {/* Mirror reflection */}
          <div className="flex items-start gap-[2px] px-4 h-6 opacity-[0.12]" style={{ transform: 'scaleY(-1)' }}>
            {bars.map((bar, i) => (
              <motion.div
                key={`mirror-${i}`}
                initial={{ scaleY: 0.08 }}
                animate={{ 
                  scaleY: isActive
                  ? [
                    bar.heightMultiplier * 0.08,
                    Math.min(0.6, Math.max(0.08, bar.heightMultiplier * 1.2 * volume)),
                    bar.heightMultiplier * 0.10
                  ] 
                  : isThinking ? [0.08, 0.12 + bar.heightMultiplier * 0.12, 0.08] : 0.06
                }}
                transition={{ 
                  duration: isThinking ? 1 : 0.35, 
                  repeat: Infinity, 
                  ease: "easeInOut",
                  delay: bar.delay 
                }}
                className={`rounded-full h-full origin-top ${getBarColor(i)}`}
                style={{
                  width: `${Math.max(3, 5 - bar.distFromCenter * 2)}px`,
                  maskImage: 'linear-gradient(to bottom, white, transparent)',
                  WebkitMaskImage: 'linear-gradient(to bottom, white, transparent)',
                  willChange: "transform",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceVisualizer;
