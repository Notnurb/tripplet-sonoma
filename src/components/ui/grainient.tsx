'use client';

import { useEffect, useRef } from 'react';

interface GrainientProps {
    color1?: string;
    color2?: string;
    color3?: string;
    className?: string;
}

export function Grainient({
    color1 = '#2e0085',
    color2 = '#5227FF',
    color3 = '#B19EEF',
    className = '',
}: GrainientProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size
        const updateSize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        updateSize();
        window.addEventListener('resize', updateSize);

        let animationId: number;
        let time = 0;

        const animate = () => {
            time += 0.001;

            // Create gradient
            const gradient = ctx.createRadialGradient(
                canvas.width / 2 + Math.sin(time) * 200,
                canvas.height / 2 + Math.cos(time) * 200,
                0,
                canvas.width / 2,
                canvas.height / 2,
                canvas.width * 0.8
            );

            gradient.addColorStop(0, color1);
            gradient.addColorStop(0.5, color2);
            gradient.addColorStop(1, color3);

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Add noise grain
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const noise = (Math.random() - 0.5) * 20;
                data[i] += noise;
                data[i + 1] += noise;
                data[i + 2] += noise;
            }
            ctx.putImageData(imageData, 0, 0);

            animationId = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', updateSize);
        };
    }, [color1, color2, color3]);

    return (
        <canvas
            ref={canvasRef}
            className={`fixed inset-0 ${className}`}
            style={{ zIndex: -1 }}
        />
    );
}
