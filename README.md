<p align="center"><img src="assets/logo.svg" alt="Basalt logo" width="96"></p>

# Basalt Landing Page (`goodmai/basalt-site`)

Official multilingual (8 languages, English default) animated landing page for **[Basalt v0.13.0](https://github.com/goodmai/basalt)** — native Swift 6.4 open-weight AI lab for Apple Silicon (`MLX` + `ANE`, `OpenAI` + `Anthropic` + `MCP`, Inkling 2 Mini looped MoE, NVFP4 & automatic ModelOpt import, PEFT LoRA, 118 hardware-tiered Compose profiles, `ZONOS3-Mini` 44.1 kHz neural TTS, Video Studio, and `Basalt.app` for macOS 27 Liquid Glass).

- **Official Website (Vercel)**: [https://bas-alt.vercel.app](https://bas-alt.vercel.app)
- **GitHub Pages Mirror**: [https://goodmai.github.io/basalt-site/](https://goodmai.github.io/basalt-site/)
- **Basalt Codebase & Releases**: [https://github.com/goodmai/basalt](https://github.com/goodmai/basalt) ([v0.13.0](https://github.com/goodmai/basalt/releases/tag/v0.13.0))
- **1-Click Hugging Face Launcher**: [https://goodmai-run-with-basalt.static.hf.space/](https://goodmai-run-with-basalt.static.hf.space/)
- **Verified Models Collection (`65+`)**: [huggingface.co/collections/goodmai/basalt-v0130-inference-speech-and-quantization-stack](https://huggingface.co/collections/goodmai/basalt-v0130-inference-speech-and-quantization-stack-6af94bed95c64cce97e188fc)

## Modern Web Platform Standards

Built as a zero-bundler static site following **[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)**:

- `color-scheme: light dark`, `light-dark()` tokens with `@media (prefers-color-scheme: dark)` & `oklab` mixing, plus `:has(> head > meta[name="color-scheme"])` FOUC-free manual theme override.
- Compositor-driven CSS Scroll-Driven Animations (`animation-timeline: scroll()` progress indicator, `animation-timeline: view()` + `animation-range: entry` card reveals, `@property` scroll-edge fades) with `prefers-reduced-motion` gating and WCAG 2.2.2 Pause/Play control.
- Physics-based `linear()` spring easings, Container Query `cqi` fluid scaling (`clamp()`), `content-visibility: auto` + `contain-intrinsic-size` below-the-fold deferral.
- Declarative Invoker Commands (`command="--copy"`, `command="show-modal"`, `command="close"`, `command="--toggle-all"`), `<dialog closedby="any">` top-layer `@starting-style` + `transition-behavior: allow-discrete` animations, `focusgroup="tablist nomemory"` + CSS Anchor Positioning tab underlines, `hidden="until-found"`, and `::details-content` `interpolate-size: allow-keywords` accordions.

## Local Preview

```bash
python3 -m http.server 8099
open http://localhost:8099
```
