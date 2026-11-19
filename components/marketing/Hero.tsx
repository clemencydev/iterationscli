'use client';
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../ui/button";
import { UseTerminal } from "@/hooks/use-terminal";
import { fractalStore } from "./fractal-store";


function Hero() {
  const { changeTerminalActive } = UseTerminal();
  const phrases = ["Iterations", "Design At Your Fingertips", "By Programmers For Programmers", "Two Foots On My Feet"];
  const [displayText, setDisplayText] = useState<string>("");
  const [finishedWriting, setFinishedWriting] = useState<boolean>(true);

  useEffect(() => {
    const typingSpeed = 80;
    const deletingSpeed = 40;
    const pauseDelay = 1200;
    const blinkSpeed = 350;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cursorBlinkInterval: ReturnType<typeof setInterval> | undefined;

    const handleTyping = (currentCharIndex: number, currentPhraseIndex: number, deletingState: boolean) => {
      const currentPhrase = phrases[currentPhraseIndex];

      if (!deletingState) {
        setDisplayText(currentPhrase.slice(0, currentCharIndex + 1));

        if (currentCharIndex + 1 === currentPhrase.length) {
          // reached the end of the phrase
          timeout = setTimeout(() => {
            handleTyping(currentCharIndex, currentPhraseIndex, true);
          }, pauseDelay);
          cursorBlinkInterval = setInterval(() => setFinishedWriting((prev) => !prev), blinkSpeed)
        } else {
          // we are currently typing
          timeout = setTimeout(() => {
            handleTyping(currentCharIndex + 1, currentPhraseIndex, false);
          }, typingSpeed);
          setFinishedWriting(false);
          clearInterval(cursorBlinkInterval);
        }
      } else {
        setDisplayText(currentPhrase.slice(0, currentCharIndex - 1));
        
        if (currentCharIndex - 1 === 0) {
          const nextIndex = (currentPhraseIndex + 1) % phrases.length;
          timeout = setTimeout(() => {
            handleTyping(0, nextIndex, false);
          }, typingSpeed);
          clearInterval(cursorBlinkInterval);

          setFinishedWriting(false);
        } else {
          timeout = setTimeout(() => {
            handleTyping(currentCharIndex - 1, currentPhraseIndex, true);
          }, deletingSpeed);
          clearInterval(cursorBlinkInterval)
          setFinishedWriting(false);
        }
      }
    };

    timeout = setTimeout(() => {
      handleTyping(0, 0, false);
    }, typingSpeed);


    return () => {
      clearTimeout(timeout);
      clearInterval(cursorBlinkInterval)
    };
  }, [phrases.length]);

  const scrollToFeatures = () => {
    const features_component = document.getElementById("#features")
    features_component?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }


  return (
    <div>
      <div data-fractal-window className="relative isolate h-screen overflow-hidden text-white flex items-center justify-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--scheme-hero-low,#000)_60%,transparent),transparent_70%)]"
        />
        <FractalControls />
        <div className="relative z-10 flex items-center flex-col ">
          <div className="flex-col items-center">
            <div>
              <h1 className="text-5xl -mt-30">
                {">"}{displayText}
                <span className={finishedWriting ? "opacity-0" : "opacity-100"}>|</span>
              </h1>
            </div>
          </div>
          <div className="flex gap-4 ">
            <Button onClick={scrollToFeatures}>Features</Button>
            <Button className=" " onClick={() => changeTerminalActive?.()}>Get Started</Button></div>
          <div className="text-gray-300 mt-10">
            Click Get Started or CTRL + Y to open the command window.
          </div>
        </div>
      </div>
    </div>
  );
}

const SERVER_SNAPSHOT = { paused: false, label: "" };

// Where the background zoom currently is, and a way to stop it.
function FractalControls() {
  const { paused, label } = useSyncExternalStore(
    fractalStore.subscribe,
    fractalStore.get,
    () => SERVER_SNAPSHOT
  );
  return (
    <div className="absolute right-5 bottom-5 z-10 flex items-center gap-3 font-mono text-[10px]">
      <span aria-hidden="true" className="text-white/50 tabular-nums">{label}</span>
      <button
        type="button"
        onClick={fractalStore.togglePaused}
        aria-pressed={paused}
        aria-label={paused ? "Resume fractal animation" : "Pause fractal animation"}
        className="border border-white/20 bg-black/60 px-3 py-2 text-white/70 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
      >
        {paused ? "▶ Resume" : "Ⅱ Pause"} zoom
      </button>
    </div>
  );
}

export default Hero;
