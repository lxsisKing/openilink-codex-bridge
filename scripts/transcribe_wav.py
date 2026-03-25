#!/usr/bin/env python3
import json
import sys

from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print('usage: transcribe_wav.py <model_size_or_path> <input.wav> [language]', file=sys.stderr)
        return 2

    model_name = sys.argv[1]
    wav_path = sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 else 'zh'

    model = WhisperModel(model_name, device='cpu', compute_type='int8')
    segments, info = model.transcribe(wav_path, language=language, vad_filter=True)
    text = ''.join(segment.text for segment in segments).strip()

    print(json.dumps({
        'language': getattr(info, 'language', language),
        'duration': getattr(info, 'duration', None),
        'text': text,
    }, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
