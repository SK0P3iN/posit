'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const SharedVideoPlayer: FC<{
  src: string;
  autoplayMuted?: boolean;
  className?: string;
  videoClassName?: string;
}> = ({ src, autoplayMuted = true, className, videoClassName }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  const tryPlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    try {
      await video.play();
      setPlaying(true);
      setNeedsGesture(false);
      setEnded(false);
    } catch {
      setPlaying(false);
      setNeedsGesture(true);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !autoplayMuted) {
      if (!autoplayMuted) {
        setNeedsGesture(true);
      }
      return;
    }
    video.muted = true;
    void tryPlay();
  }, [autoplayMuted, src, tryPlay]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video || error) {
      return;
    }
    if (video.paused || video.ended) {
      await tryPlay();
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const next = !muted;
    video.muted = next;
    setMuted(next);
    if (!next && video.volume === 0) {
      video.volume = 1;
      setVolume(1);
    }
  };

  const onVolumeChange = (value: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const next = Math.min(1, Math.max(0, value));
    video.volume = next;
    setVolume(next);
    if (next > 0 && muted) {
      video.muted = false;
      setMuted(false);
    }
    if (next === 0) {
      video.muted = true;
      setMuted(true);
    }
  };

  const onSeek = (value: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(value)) {
      return;
    }
    setSeeking(true);
    video.currentTime = value;
    setCurrentTime(value);
    setEnded(false);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className={clsx(
        'relative w-full h-full bg-black rounded-[10px] overflow-hidden',
        className
      )}
    >
      <video
        ref={videoRef}
        src={src}
        className={clsx('w-full h-full object-contain', videoClassName)}
        muted={muted}
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
          setError(false);
        }}
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime);
          setSeeking(false);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => {
          setBuffering(false);
          setPlaying(true);
          setEnded(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
        }}
        onError={() => {
          setError(true);
          setPlaying(false);
          setBuffering(false);
        }}
        onClick={() => void togglePlay()}
      />

      {error && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/80 text-white text-sm px-4 text-center"
          role="alert"
        >
          Video could not be loaded.
        </div>
      )}

      {!error && needsGesture && !playing && (
        <button
          type="button"
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center bg-black/40"
          onClick={() => void tryPlay()}
        >
          <span className="w-14 h-14 rounded-full border-2 border-white/80 bg-black/55 flex items-center justify-center text-white text-xl">
            ▶
          </span>
        </button>
      )}

      {!error && ended && !playing && (
        <button
          type="button"
          aria-label="Replay"
          className="absolute inset-0 flex items-center justify-center bg-black/40"
          onClick={() => {
            const video = videoRef.current;
            if (video) {
              video.currentTime = 0;
            }
            void tryPlay();
          }}
        >
          <span className="px-4 py-2 rounded-full border border-white/70 bg-black/60 text-white text-sm">
            Replay
          </span>
        </button>
      )}

      {muted && !error && (
        <button
          type="button"
          aria-label="Unmute"
          aria-pressed={false}
          className="absolute top-3 right-3 z-10 rounded-full border border-white/40 bg-black/70 px-3 py-1.5 text-xs text-white"
          onClick={toggleMute}
        >
          Unmute
        </button>
      )}

      {!error && (
        <div className="absolute left-0 right-0 bottom-0 z-10 bg-black/70 px-3 py-2 flex flex-col gap-1.5">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            aria-label="Seek"
            disabled={buffering && !seeking}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="w-full h-2 bg-fifth rounded-lg appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #fff 0%, #fff ${progress}%, #374151 ${progress}%, #374151 100%)`,
            }}
          />
          <div className="flex items-center gap-2 text-white text-xs">
            <button
              type="button"
              aria-label={playing ? 'Pause' : 'Play'}
              aria-pressed={playing}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10"
              onClick={() => void togglePlay()}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="tabular-nums min-w-[4.5rem]">
              {formatTime(currentTime)} / {formatTime(duration)}
              {buffering || seeking ? ' …' : ''}
            </span>
            <button
              type="button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 ml-auto"
              onClick={toggleMute}
            >
              {muted || volume === 0 ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="w-20 h-2 bg-fifth rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
