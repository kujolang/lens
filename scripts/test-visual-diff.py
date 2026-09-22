#!/usr/bin/env python3
"""Verify pixel classification, rendered diffs, and visual error contracts."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('visual', ROOT / 'bridge/visual-diff.py')
visual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(visual)


class VisualTests(unittest.TestCase):
    def test_all_channel_pairs_and_diff_pixels(self):
        # Exhaustive byte subtraction, including underflow and threshold edges.
        current = np.repeat(np.arange(256, dtype=np.uint8)[:, None, None], 256, axis=1)
        current = np.repeat(current, 3, axis=2)
        baseline = current.transpose(1, 0, 2).copy()
        expected = np.any(np.abs(current.astype(int) - baseline.astype(int)) > 10, axis=2)
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            Image.fromarray(current).save(work / 'current.png')
            Image.fromarray(baseline).save(work / 'baseline.png')
            result = visual.compare_images(work / 'current.png', work / 'baseline.png', 0, str(work / 'diff.png'))
            self.assertEqual(result['status'], 'fail')
            self.assertEqual(result['changed_pixels'], int(expected.sum()))
            self.assertEqual(result['total_pixels'], 65536)
            self.assertEqual(result['difference_ratio'], round(float(expected.mean()), 6))
            with Image.open(work / 'diff.png') as image:
                actual = np.array(image)
            reference = np.where(expected[..., None], [255, 0, 0], (current * .5).astype(np.uint8))
            np.testing.assert_array_equal(actual, reference)

    def test_equal_dimensions_alpha_and_missing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            a, b = work / 'a.png', work / 'b.png'
            self.assertEqual(visual.compare_images(a, b)['status'], 'error')
            Image.new('RGBA', (2, 3), (2, 3, 4, 0)).save(a)
            self.assertEqual(visual.compare_images(a, b)['status'], 'missing_baseline')
            Image.new('RGB', (2, 3), (2, 3, 4)).save(b)
            self.assertEqual(visual.compare_images(a, b, 0)['status'], 'pass')
            Image.new('RGB', (3, 3)).save(b)
            self.assertEqual(visual.compare_images(a, b)['status'], 'dimension_mismatch')
            b.write_text('invalid image')
            self.assertEqual(visual.compare_images(a, b)['status'], 'error')


if __name__ == '__main__':
    unittest.main()
