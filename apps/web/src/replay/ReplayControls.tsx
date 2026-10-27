interface ReplayControlsProps {
  readonly frame: number;
  readonly frameCount: number;
  readonly isPlaying: boolean;
  readonly speed: number;
  readonly canJumpToPayout: boolean;
  readonly onFrameChange: (frame: number) => void;
  readonly onPlayToggle: () => void;
  readonly onSpeedChange: (speed: number) => void;
  readonly onJumpToPayout: () => void;
}

export function ReplayControls(props: ReplayControlsProps) {
  return (
    <section className="replay-controls" aria-label="Replay controls">
      <button className="primary-control" type="button" onClick={props.onPlayToggle}>
        {props.isPlaying ? "Pause replay" : "Play replay"}
      </button>
      <button
        type="button"
        onClick={() => props.onFrameChange(Math.max(0, props.frame - 1))}
        disabled={props.frame === 0}
      >
        Step back
      </button>
      <button
        type="button"
        onClick={() => props.onFrameChange(Math.min(props.frameCount - 1, props.frame + 1))}
        disabled={props.frame === props.frameCount - 1}
      >
        Step forward
      </button>
      <label className="scrubber">
        <span>Replay position</span>
        <input
          aria-label="Replay position"
          type="range"
          min="0"
          max={props.frameCount - 1}
          value={props.frame}
          onChange={(event) => props.onFrameChange(Number(event.target.value))}
        />
      </label>
      <div className="speed-controls" aria-label="Playback speed">
        {[0.5, 1, 2].map((speed) => (
          <button
            aria-pressed={props.speed === speed}
            key={speed}
            type="button"
            onClick={() => props.onSpeedChange(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={props.onJumpToPayout}
        disabled={!props.canJumpToPayout}
      >
        Jump to next payout
      </button>
    </section>
  );
}
