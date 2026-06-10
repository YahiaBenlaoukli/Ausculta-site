"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const TOTAL_FRAMES = 150;
const FRAME_PATH = "/sequences/heart/";

export default function HeartBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const frameRef = useRef(0);
  const directionRef = useRef(1);
  const lastScrollRef = useRef(0);
  const velocityRef = useRef(0);
  const smoothVelocityRef = useRef(0);
  const lastTimeRef = useRef(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const drawFrame = useCallback((frameIndex: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = imagesRef.current[frameIndex];
    if (!img || !img.complete) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    // Preload all images in batches
    const images: HTMLImageElement[] = [];
    let loadedCount = 0;

    function loadBatch(startIdx: number, batchSize: number) {
      const end = Math.min(startIdx + batchSize, TOTAL_FRAMES);
      for (let i = startIdx; i < end; i++) {
        const img = new Image();
        const num = (i + 1).toString().padStart(4, "0");
        img.src = `${FRAME_PATH}${num}.png`;
        img.onload = () => {
          loadedCount++;
          if (loadedCount === 1) {
            // Draw first frame immediately
            drawFrame(0);
            setIsLoaded(true);
          }
          // Load next batch when this one finishes
          if (loadedCount === end && end < TOTAL_FRAMES) {
            loadBatch(end, batchSize);
          }
        };
        images[i] = img;
      }
    }

    imagesRef.current = images;
    // Load in groups of 25
    loadBatch(0, 25);
  }, [drawFrame]);

  useEffect(() => {
    let rafId: number;

    const animate = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      const delta = Math.max(time - lastTimeRef.current || 0, 16);
      lastTimeRef.current = time;

      // Scroll-driven velocity (like the original)
      const scrollY = Math.max(document.documentElement.scrollTop, 0);
      const scrollDelta = Math.min(3, Math.max(-3, scrollY - lastScrollRef.current));
      velocityRef.current = scrollDelta;
      lastScrollRef.current = scrollY;

      if (scrollDelta !== 0) {
        directionRef.current = Math.sign(scrollDelta);
      }

      // If no scroll movement, use a gentle idle drift based on last direction
      const drive = scrollDelta || (scrollY > 0 ? 0 : 1) * directionRef.current;

      // Smooth interpolation (like the original's exponential smoothing)
      smoothVelocityRef.current =
        Math.round(
          (smoothVelocityRef.current +
            (drive - smoothVelocityRef.current) * (1 - Math.exp(-0.5 * delta))) *
          10000
        ) / 10000;

      // Clamp near-zero
      if (
        smoothVelocityRef.current > -0.1 &&
        smoothVelocityRef.current < 0.1
      ) {
        smoothVelocityRef.current = 0;
      }

      // Advance frame
      const nextFrame =
        ((frameRef.current +
          smoothVelocityRef.current * (delta / 60)) %
          TOTAL_FRAMES +
          TOTAL_FRAMES) %
        TOTAL_FRAMES;
      frameRef.current = nextFrame;

      drawFrame(Math.floor(frameRef.current));

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]);

  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-[1] flex items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        width={512}
        height={512}
        className={`w-full h-full max-w-[700px] max-h-[700px] object-contain transition-opacity duration-1000 ease-in-out mix-blend-multiply ${isLoaded ? "opacity-35" : "opacity-0"
          }`}
        style={{ filter: "saturate(0.8)" }}
      />
    </div>
  )
}
