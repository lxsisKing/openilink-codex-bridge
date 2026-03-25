#!/usr/bin/env python3
import sys
from pilk import silk_to_wav


def main() -> int:
    if len(sys.argv) != 4:
        print('usage: decode_silk.py <input.silk> <output.wav> <sample_rate>', file=sys.stderr)
        return 2

    src, dst, sample_rate_s = sys.argv[1:4]
    sample_rate = int(sample_rate_s)

    silk_to_wav(src, dst, rate=sample_rate)
    print(f'decoded {src} -> {dst} @ {sample_rate}Hz')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
