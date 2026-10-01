import * as tf from "@tensorflow/tfjs";
import * as mobilenet from "@tensorflow-models/mobilenet";

let model: mobilenet.MobileNet | null = null;

// Initialize model asynchronously
async function initModel() {
  try {
    await tf.ready();
    model = await mobilenet.load({
      version: 2,
      alpha: 1.0,
    });
    console.log("[ProctorWorker] AI Models Loaded Successfully");
  } catch (e) {
    console.error("[ProctorWorker] AI Modle Init Failed!", e);
  }
}

// Prediction Loop for Object Detection
const offscreen = new OffscreenCanvas(224, 224);
const ctx = offscreen.getContext("2d");

async function detectObjects(imageBitmap: ImageBitmap) {
  if (!model || !ctx) return null;

  try {
    // Draw bitmap to offscreen canvas to get ImageData / compatible input
    ctx.drawImage(imageBitmap, 0, 0, 224, 224);
    const predictions = await model.classify(offscreen as any);
    
    // Search for suspicious objects
    const prohibited = ["mobile phone", "cellular telephone", "handheld computer", "notebook", "book", "laptop"];
    const found = predictions.find(p => 
      prohibited.some(ph => p.className.toLowerCase().includes(ph)) && p.probability > 0.45
    );

    if (found) {
      return { label: found.className, confidence: found.probability };
    }
    return null;
  } catch (e) {
    return null;
  }
}

self.onmessage = async (event) => {
  const { type, data } = event.data;

  if (type === "init") {
    await initModel();
    self.postMessage({ type: "ready" });
  }

  if (type === "process-frame") {
    const { imageBitmap } = data;
    const objectResult = await detectObjects(imageBitmap);
    
    // Transfer back results
    self.postMessage({
      type: "result",
      data: {
         object: objectResult
      }
    });

    // Close the bitmap to free memory in worker
    imageBitmap.close();
  }
};
