import React, { useState, useRef, useEffect } from "react";
import { Camera, RefreshCw, CheckCircle2, ShieldCheck, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { uploadIdImage } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  inviteToken: string;
  onVerified: (imageUrl: string) => void;
}

export default function IdentityVerification({ inviteToken, onVerified }: Props) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1280 }, height: { ideal: 720 } } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      setError(null);
    } catch (err) {
      console.error("Camera access error:", err);
      setError("Unable to access camera. Please ensure permissions are granted.");
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Flip horizontal if it's a front camera for more natural experience
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setCapturedImage(dataUrl);
      
      // Stop camera to save resources while reviewing
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
    }
  };

  const retake = () => {
    setCapturedImage(null);
    startCamera();
  };

  const handleUpload = async () => {
    if (!capturedImage) return;

    setIsUploading(true);
    try {
      // Convert dataUrl to Blob
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      
      const result = await uploadIdImage(inviteToken, blob);
      if (result.success) {
        toast({
          title: "ID Verified",
          description: "Your identity document has been securely captured.",
        });
        onVerified(result.candidate_id_url);
      }
    } catch (err) {
      console.error("Upload error:", err);
      toast({
        title: "Upload Failed",
        description: "Failed to upload ID image. Please try again.",
        variant: "destructive",
      });
      setIsUploading(false);
    }
  };

  return (
    <Card className="max-w-2xl mx-auto overflow-hidden bg-slate-950 border-slate-800 shadow-2xl">
      <div className="p-6 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Identity Verification</h2>
            <p className="text-sm text-slate-400">Please show a valid government-issued ID proof to the camera.</p>
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="relative aspect-video rounded-md overflow-hidden bg-slate-900 border border-slate-800 shadow-inner">
          <AnimatePresence mode="wait">
            {!capturedImage ? (
              <motion.div 
                key="camera"
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="w-full h-full"
              >
                {error ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                    <p className="text-red-400 font-medium mb-4">{error}</p>
                    <Button onClick={startCamera} variant="outline" className="border-slate-700">
                      Try Again
                    </Button>
                  </div>
                ) : (
                  <>
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      muted 
                      className="w-full h-full object-cover grayscale-[0.2]"
                    />
                    {/* ID Overlay Guide */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-[70%] h-[60%] border-2 border-dashed border-primary/50 rounded-md bg-primary/5 flex flex-col items-center justify-center">
                        <div className="w-12 h-12 border-2 border-primary/30 rounded-full flex items-center justify-center mb-2">
                          <Camera className="w-6 h-6 text-primary/40" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-primary/60">Position ID Here</span>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="preview"
                initial={{ opacity: 0, scale: 1.05 }} 
                animate={{ opacity: 1, scale: 1 }} 
                className="w-full h-full"
              >
                <img src={capturedImage} alt="Captured ID" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-green-500/10 border-4 border-green-500/30" />
              </motion.div>
            )}
          </AnimatePresence>
          
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
          {!capturedImage ? (
            <Button 
              onClick={capturePhoto} 
              disabled={!stream}
              size="lg"
              className="px-8 h-12 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-bold uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
            >
              <Camera className="w-5 h-5 mr-2" />
              Capture ID Photo
            </Button>
          ) : (
            <>
              <Button 
                onClick={retake} 
                variant="outline"
                size="lg"
                disabled={isUploading}
                className="px-8 h-12 rounded-md border-slate-700 text-slate-300 hover:bg-slate-800 font-bold uppercase tracking-widest"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retake
              </Button>
              <Button 
                onClick={handleUpload} 
                disabled={isUploading}
                size="lg"
                className="px-8 h-12 rounded-md bg-green-600 hover:bg-green-500 text-white font-bold uppercase tracking-widest shadow-lg shadow-green-900/20 transition-all hover:scale-105 active:scale-95"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Confirm & Proceed
                  </>
                )}
              </Button>
            </>
          )}
        </div>
        
        <p className="mt-6 text-center text-[10px] text-slate-500 font-medium uppercase tracking-[0.2em] max-w-sm mx-auto">
          Your ID will be stored securely and used only for identity verification purposes during this interview session.
        </p>
      </div>
    </Card>
  );
}
