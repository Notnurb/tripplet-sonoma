/**
 * Inlined low-quality image previews (LQIP) for the large hero backgrounds.
 *
 * Each is a ~24px-wide, blurred, base64 JPEG (a few hundred bytes) that ships in
 * the HTML/JS and renders INSTANTLY — no network round-trip. The full-resolution
 * asset (the 4 MB sky JPEG / the code-bg video + its poster) then swaps in on top
 * as fast as it downloads, so the user never sees a blank white/black flash.
 *
 * Regenerate with sharp if the source art changes:
 *   sharp(file).resize(24).blur(1.2).jpeg({ quality: 40 }).toBuffer()
 */

// public/sky-clouds.jpg — homepage hero.
export const SKY_BLUR =
    'data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCABsABgDASIAAhEBAxEB/8QAGQAAAwEBAQAAAAAAAAAAAAAAAAIDAQQG/8QAIRAAAgICAwACAwAAAAAAAAAAAAECEQMhBBIxQWEyUXH/xAAWAQEBAQAAAAAAAAAAAAAAAAABAAL/xAAWEQEBAQAAAAAAAAAAAAAAAAAAEQH/2gAMAwEAAhEDEQA/APS5MNkVx6kWzchw+LJLkOUvBuszFox6oDE3P6Aao55SkyblJP8AEo0K19kmRzSWqoDLSAQdyFexOwWCDiAWBoObFyFJU/SvevWcuPi5flpFXxn7dsZguqdwJRxzSpICirpsxsk5h22BqlgRc2AhPsw7Uv2zN0J/fSBnJgEHvfgCmttCtUiGPJKnspCbclZmmHdKO2A2SCAao//Z';

// public/hq720.jpg — the code page's video poster still.
export const CODE_BLUR =
    'data:image/jpeg;base64,/9j/2wBDABQODxIPDRQSEBIXFRQYHjIhHhwcHj0sLiQySUBMS0dARkVQWnNiUFVtVkVGZIhlbXd7gYKBTmCNl4x9lnN+gXz/2wBDARUXFx4aHjshITt8U0ZTfHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHz/wAARCAAOABgDASIAAhEBAxEB/8QAGAAAAwEBAAAAAAAAAAAAAAAAAAMEAgb/xAAZEAADAQEBAAAAAAAAAAAAAAAAAQIDEiH/xAAVAQEBAAAAAAAAAAAAAAAAAAACA//EABgRAAMBAQAAAAAAAAAAAAAAAAABAhES/9oADAMBAAIRAxEAPwDj1JrnwdMoZWaSLKNJOyNyBRWaALkXR//Z';
