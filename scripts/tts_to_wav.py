#!/usr/bin/env python3
import subprocess
import sys
import tempfile
import os


def main() -> int:
    if len(sys.argv) != 3:
        print('usage: tts_to_wav.py <text> <output.wav>', file=sys.stderr)
        return 2

    text = sys.argv[1].strip()
    output = sys.argv[2]
    if not text:
        print('text is empty', file=sys.stderr)
        return 1

    fd, tmp_wav = tempfile.mkstemp(suffix='.wav', prefix='espeak-raw-')
    os.close(fd)
    try:
        result = subprocess.run(
            ['espeak-ng', '-v', 'zh', '-s', '180', '-w', tmp_wav, text],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(result.stderr.strip() or result.stdout.strip() or 'espeak-ng failed', file=sys.stderr)
            return result.returncode

        ff = subprocess.run(
            [
                'ffmpeg', '-y', '-i', tmp_wav,
                '-ac', '1',
                '-ar', '24000',
                '-sample_fmt', 's16',
                output,
            ],
            capture_output=True,
            text=True,
        )
        if ff.returncode != 0:
            print(ff.stderr.strip() or ff.stdout.strip() or 'ffmpeg convert failed', file=sys.stderr)
            return ff.returncode

        print(output)
        return 0
    finally:
        try:
            os.remove(tmp_wav)
        except FileNotFoundError:
            pass


if __name__ == '__main__':
    raise SystemExit(main())
