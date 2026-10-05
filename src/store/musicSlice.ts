import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Lyrics, Track } from "../types/music";

interface MusicState { track: Track | null; lyrics: Lyrics[]; similar: Track[]; loading: boolean; error: string | null; }
const initialState: MusicState = { track: null, lyrics: [], similar: [], loading: false, error: null };

const musicSlice = createSlice({
  name: "music", initialState,
  reducers: {
    startLoading(state) { state.loading = true; state.error = null; },
    setTrack(state, action: PayloadAction<Track | null>) { state.track = action.payload; state.loading = false; },
    setLyrics(state, action: PayloadAction<Lyrics[]>) { state.lyrics = action.payload; state.loading = false; },
    setSimilar(state, action: PayloadAction<Track[]>) { state.similar = action.payload; state.loading = false; },
    setError(state, action: PayloadAction<string>) { state.error = action.payload; state.loading = false; },
    resetResults(state) { state.track = null; state.lyrics = []; state.similar = []; state.error = null; },
  },
});
export const { startLoading, setTrack, setLyrics, setSimilar, setError, resetResults } = musicSlice.actions;
export default musicSlice.reducer;