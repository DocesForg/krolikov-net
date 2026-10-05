import type { MusicRecognition, Track } from "../types/music";

interface RecognitionResponse {
  track: Track | null;
  score?: number | null;
  error?: string;
}

export class AcoustIdRecognitionService {
  async recognize(file: File): Promise<MusicRecognition> {
    const body = new FormData();
    body.append("file", file);

    const response = await fetch("/api/recognize/file", {
      method: "POST",
      body,
    });

    const data = (await response.json()) as RecognitionResponse;
    if (!response.ok) {
      throw new Error(data.error || `Recognition HTTP ${response.status}`);
    }

    return { track: data.track ?? null };
  }
}
