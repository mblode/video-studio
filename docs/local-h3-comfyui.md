# Local MiniMax H3 through ComfyUI

`video-studio` normally sends `MiniMax-H3` to MiniMax's hosted v2 API. That is
not local inference. The explicit model id below selects the separate ComfyUI
adapter:

```json
{
  "film": {
    "model": "comfyui:MiniMax-H3-Local",
    "defaults": {
      "ratio": "16:9",
      "duration": 5,
      "resolution": "480p",
      "generateAudio": true
    }
  }
}
```

Set the local endpoint and run the normal pipeline:

```bash
COMFYUI_BASE_URL=http://127.0.0.1:8188 \
  vs generate films/my-film/shots.json --yes --timeout 20
```

The provider maps ComfyUI's `/prompt`, `/queue`, `/history/{prompt_id}`, and
`/view` endpoints onto the existing submit, poll, manifest, and download
lifecycle. Bind ComfyUI to localhost; its HTTP API has no authentication. Use an
SSH tunnel rather than exposing it when the CLI and GPU host are different.

## Proven MS-02 configuration

This combination completed a playable H.264/AAC MP4 on an NVIDIA RTX PRO 4000
Blackwell SFF Edition with 24,467 MiB VRAM:

- ComfyUI 0.30.0;
- Python 3.12;
- PyTorch 2.11.0+cu128 / CUDA 12.8;
- NVIDIA driver 596.72, compute capability `sm120`;
- `--lowvram --preview-method none`;
- 20 `res_multistep` steps at 24 fps;
- 608x352, 124 frames (5.167 seconds);
- peak observed allocation about 23.55/24.47 GB;
- 339.55 seconds inside ComfyUI, 371.7 seconds end to end.

The four checkpoint components occupy 42,470,585,471 bytes (39.554 GiB):

| ComfyUI folder | Filename | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `diffusion_models/` | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | 20,970,379,616 | `e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a` |
| `text_encoders/` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 15,687,142,551 | `35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6` |
| `vae/` | `minimax_h3_video_vae_fp16.safetensors` | 5,207,808,496 | `7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522` |
| `vae/` | `minimax_h3_audio_vae_fp32.safetensors` | 605,254,808 | `8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48` |

The diffusion checkpoint and encoder are community quantizations from
`Abiray/Minimax-H3-nvfp4-INT4-INT8-Convrot`, declared as quantized derivatives
of `MiniMaxAI/MiniMax-H3`. The visual/audio VAEs originate from the H3 model
release. Do not describe this exact runtime as an all-official checkpoint.

## Resolution and feature boundary

The adapter's `480p` draft tier deliberately maps to a tested low-VRAM canvas,
not a literal 480-pixel short side:

| Ratio | Draft canvas |
| --- | --- |
| 16:9 | 608x352 |
| 9:16 | 352x608 |
| 4:3 | 512x384 |
| 3:4 | 384x512 |
| 1:1 | 448x448 |
| 21:9 | 640x288 |

This is the only tier proven on the 24 GB MS-02. The adapter can construct the
native 768p canvas, but that path is unverified and should not be assumed to fit
or be practical on this GPU.

Current adapter scope is intentionally **text-to-video only**. Local first/last
frame and Ref2VA support need an asset-upload layer because native ComfyUI
`LoadImage` consumes server-side files rather than the remote URLs used by the
hosted provider. Until that layer exists, references are rejected before
submission. Local H3 Base still generates joint 32 kHz stereo audio.

This local path is H3 Base only. The official hosted H3-Context-IR preprocessor
and H3-Regenerate-2K module are not part of the open model release, so local
output should not be presented as feature- or quality-equivalent to MiniMax's
full hosted 2K service.

## License boundary

The model is not Apache/MIT software. The weights and their quantized
derivatives are governed by the **MiniMax H3 Community License Agreement**
(August 2, 2026). Operational implications from the published terms include:

- Australia is in the Applicable Territory. The excluded territories are the
  EU, UK, Republic of Korea, and United States.
- Commercial use is permitted in the Applicable Territory, but a commercial
  product or service with more than USD 20 million in annual revenue needs
  prior written authorization from MiniMax.
- A commercial UI using the model must prominently display `MiniMax H3`.
- The license restricts use and distribution of both the model and its outputs
  outside the Applicable Territory.
- A hosted product must bind users to equivalent restrictions and operate
  safeguards, abuse reporting, investigation, and repeat-violator controls.
- MiniMax claims no rights over generated outputs, subject to the agreement and
  third-party rights.
- H3 outputs may not be used to improve a different AI model.

Read the complete current license before product deployment:
<https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE>. This summary is
an engineering constraint map, not legal advice.

## Success gates

Treat the stages separately:

1. ComfyUI starts.
2. The checkpoint and text encoder load.
3. Denoising executes without OOM/CUDA errors.
4. Video and audio decode.
5. `vs` downloads a playable MP4 and records it in the task manifest.
6. Output quality and wall-clock time are acceptable for the intended workflow.

A server startup message proves only stage 1. The MS-02 run described above
passed stages 1-5. A second run through `vs generate` produced and downloaded a
608x352, 107-frame, 4.458-second H.264/AAC clip in 292 seconds observed by the
CLI (268.32 seconds inside ComfyUI). Practical production quality remains a
creative and throughput decision. In both measured samples, generated audio was
very quiet and would need gain normalization during film assembly.
