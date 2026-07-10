import { WATERMARK_TEXT } from "@/components/ui/watermark";

// Helper to fetch image as blob, trying direct then proxy
async function fetchImageBlob(url: string): Promise<Blob> {
    try {
        // Try direct fetch first
        const res = await fetch(url, { mode: 'cors' });
        if (res.ok) return await res.blob();
        throw new Error('Direct fetch failed');
    } catch (e) {
        // Fallback to proxy
        const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Proxy fetch failed: ${res.statusText}`);
        return await res.blob();
    }
}

/**
 * Downloads an image with a watermark baked into it.
 * @param imageUrl The URL of the image to watermark and download
 * @param filename The name to save the file as
 */
export async function downloadWithWatermark(imageUrl: string, filename: string) {
    let objectUrl: string | null = null;

    try {
        // 1. Fetch image data as blob to avoid CORS taint on canvas
        const blob = await fetchImageBlob(imageUrl);
        objectUrl = URL.createObjectURL(blob);

        // 2. Create a canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');

        // 3. Load the main image from the local blob URL
        const img = new Image();
        // No need for crossOrigin with local blob URL

        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = objectUrl!;
        });

        // 4. Set canvas dimensions to image dimensions
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        // 5. Draw the main image
        ctx.drawImage(img, 0, 0);

        // 6. Draw Text Watermark "Tripplet"
        const text = WATERMARK_TEXT || "Tripplet";

        // Calculate font size (e.g., 2% of image height, min 12px)
        const fontSize = Math.max(12, Math.round(canvas.height * 0.02));
        ctx.font = `500 ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Position: Top Middle with small padding
        const x = canvas.width / 2;
        const y = canvas.height * 0.02; // 2% from top

        ctx.save();
        // Styles for "barely noticeable"
        ctx.globalAlpha = 0.3; // Low opacity
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // White text
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'; // Slight shadow for contrast if image is white
        ctx.shadowBlur = 2;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        ctx.fillText(text, x, y);
        ctx.restore();

        // 7. Convert to blob and download
        canvas.toBlob((blob) => {
            if (!blob) {
                throw new Error('Canvas to Blob failed');
            }
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a); // Append to body to ensure click works in firefox
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
        }, 'image/png');

    } catch (error) {
        // Fallback: Force download of original URL if possible via proxy
        try {
            const blob = await fetchImageBlob(imageUrl);
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
        } catch (e) {
            // Last resort
            window.open(imageUrl, '_blank');
        }
    } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}
