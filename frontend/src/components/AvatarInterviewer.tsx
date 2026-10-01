import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, ContactShadows, Float } from '@react-three/drei';
import * as THREE from 'three';

/**
 * High-fidelity 3D Avatar Interviewer component.
 * Uses real-time volume-based lip-sync and smooth animations.
 */
function AvatarModel({ isSpeaking, volume }: { isSpeaking: boolean; volume: number }) {
  // Use public path for the avatar model
  const { scene, nodes, materials } = useGLTF('/avatar.glb');
  const headRef = useRef<THREE.Group>(null);
  
  // Create smooth volume for morph targets
  const smoothedVolume = useRef(0);

  useFrame((state) => {
    if (!headRef.current) return;

    // Smooth out the incoming volume signal for natural movement
    smoothedVolume.current = THREE.MathUtils.lerp(
      smoothedVolume.current,
      isSpeaking ? volume : 0,
      0.2
    );

    // Apply lip sync via morph targets if available 
    // Usually 'jawOpen' is the most effective for volume-based sync
    scene.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && child.morphTargetInfluences) {
        // Find indices for jawOpen or mouthOpen
        const jawIndex = child.morphTargetDictionary ? 
          (child.morphTargetDictionary['jawOpen'] ?? child.morphTargetDictionary['mouthOpen']) : 
          undefined;

        if (jawIndex !== undefined) {
          child.morphTargetInfluences[jawIndex] = smoothedVolume.current * 1.5;
        }

        // Add some subtle eye blinking
        const eyeBlinkIndex = child.morphTargetDictionary ? 
          (child.morphTargetDictionary['eyeBlinkLeft'] ?? child.morphTargetDictionary['eyesClosed']) : 
          undefined;
        
        if (eyeBlinkIndex !== undefined) {
          const blink = Math.sin(state.clock.elapsedTime * 0.5) > 0.98 ? 1 : 0;
          child.morphTargetInfluences[eyeBlinkIndex] = THREE.MathUtils.lerp(
            child.morphTargetInfluences[eyeBlinkIndex],
            blink,
            0.5
          );
        }
      }
    });

    // Subtle idle head movement
    const t = state.clock.getElapsedTime();
    headRef.current.rotation.y = Math.sin(t * 0.5) * 0.1;
    headRef.current.rotation.x = Math.cos(t * 0.3) * 0.05;
  });

  return (
    <group ref={headRef} position={[0, -1.6, 0]}>
      <primitive object={scene} />
    </group>
  );
}

export default function AvatarInterviewer({ isSpeaking = false, volume = 0 }) {
  return (
    <div className="w-full h-[400px] bg-card rounded-md overflow-hidden border border-border/50 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40 pointer-events-none z-10" />
      
      <Canvas
        shadows
        camera={{ position: [0, 0, 1.2], fov: 40 }}
        style={{ background: 'radial-gradient(circle at center, #1a1a2e 0%, #02020a 100%)' }}
      >
        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />
        <Environment preset="city" />
        
        <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.2}>
          <AvatarModel isSpeaking={isSpeaking} volume={volume} />
        </Float>
        
        <ContactShadows opacity={0.4} scale={10} blur={2.4} far={0.8} />
      </Canvas>

      {/* Modern Overlay Effects */}
      <div className="absolute top-4 left-4 z-20 flex gap-2">
        <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-cyan-400 animate-pulse' : 'bg-white/20'}`} />
        <div className="w-2 h-2 rounded-full bg-white/10" />
        <div className="w-2 h-2 rounded-full bg-white/10" />
      </div>
    </div>
  );
}

// Pre-load the avatar for zero-latency appearance
useGLTF.preload('/avatar.glb');
