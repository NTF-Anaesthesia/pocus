#!/usr/bin/env python3
"""Turn a cardiac chamber labelmap (NIfTI) into the 3D textures the probe simulator samples.

Input labels (STACOM 2025 / ImageCAS convention): 0 background, 1 LV myocardium, 2 LA, 3 LV, 4 RA, 5 RV, 6 aorta,
7 pulmonary artery, 8 left atrial appendage, 9 coronaries, 10 pulmonary veins.

Output, in the target folder:
  heart-labels.png   tiled 8-bit atlas of the resampled volume with synthesised structures added:
                     11 thin wall (RV, atria, appendage, veins), 12 vessel wall (aorta, PA), 13 mitral plane,
                     14 tricuspid plane, 15 pericardium, 16 epicardial fat / lung exclusion band
  heart-sdf.png      tiled 8-bit atlas of the signed distance to the nearest blood-tissue interface, 128 = 0,
                     scaled so one unit = 0.1 mm... (see SDF_RANGE_MM): the renderer takes its specular normals here
  heart-volume.json  spacing, size, tiling, label meaning, the LV long axis and chamber centroids in volume mm

Usage:  heart-volume.py labelmap.nii.gz out_dir [--spacing 1.5]
        heart-volume.py --synthetic out_dir            (ellipsoid test volume, to exercise the pipeline)
Run with python3 -I. Needs nibabel, numpy, scipy, Pillow.
"""
import sys, json, argparse
import numpy as np
from scipy import ndimage
from PIL import Image

SDF_RANGE_MM = 12.0   # ±12 mm maps to 0..255

def synthetic(spacing):
    """Ellipsoid chambers in the STACOM label scheme, roughly adult sized, long axis along +z."""
    n = int(140 / spacing); g = np.indices((n, n, n)).astype(np.float32) * spacing - 70
    x, y, z = g
    lab = np.zeros((n, n, n), np.uint8)
    def ell(cx, cy, cz, rx, ry, rz): return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1
    lab[ell(0, 0, 10, 32, 32, 48)] = 1                      # LV wall outer
    lab[ell(0, 0, 10, 22, 22, 40)] = 3                      # LV cavity
    lab[ell(-30, -8, 5, 30, 26, 44) & ~(lab > 0) & (x < -8)] = 5   # RV crescent
    lab[ell(8, 18, -42, 20, 20, 18)] = 2                    # LA
    lab[ell(-22, 24, -40, 19, 19, 18)] = 4                  # RA
    lab[ell(-6, -22, -50, 13, 13, 24) & (lab == 0)] = 6     # aorta
    lab[ell(-30, -30, -36, 10, 10, 16) & (lab == 0)] = 7    # PA
    return lab, np.array([spacing] * 3, np.float32), np.eye(4)

def load(path, spacing):
    import nibabel as nib
    im = nib.load(path); lab = np.asarray(im.dataobj).astype(np.uint8)
    zooms = np.array(im.header.get_zooms()[:3], np.float32)
    # resample to isotropic spacing with nearest neighbour
    factor = zooms / spacing
    lab = ndimage.zoom(lab, factor, order=0)
    return lab, np.array([spacing] * 3, np.float32), im.affine

def build(lab, spacing):
    blood = np.isin(lab, [2, 3, 4, 5, 6, 7, 8, 10])
    tissue = lab == 1
    out = lab.copy()
    mm = lambda d: max(1, int(round(d / spacing[0])))
    ball = lambda r: ndimage.iterate_structure(ndimage.generate_binary_structure(3, 1), r)
    # thin walls around chambers and veins that the labelmap leaves as bare blood pools
    thin = np.isin(lab, [2, 4, 5, 8, 10])
    wall = ndimage.binary_dilation(thin, ball(mm(3.5))) & (out == 0)
    out[wall] = 11
    vessel = np.isin(lab, [6, 7])
    vwall = ndimage.binary_dilation(vessel, ball(mm(2.0))) & (out == 0)
    out[vwall] = 12
    # valve planes: where LA touches LV, and RA touches RV (dilate each by 2 mm, take the overlap)
    for a, b, code in [(2, 3, 13), (4, 5, 14)]:
        da = ndimage.binary_dilation(lab == a, ball(mm(2.0))); db = ndimage.binary_dilation(lab == b, ball(mm(2.0)))
        out[da & db & blood] = code
    # pericardium: a 2 mm shell outside everything cardiac, then an 8 mm band for pericardial fat / lung exclusion
    heart = out > 0
    peri = ndimage.binary_dilation(heart, ball(mm(2.0))) & ~heart
    out[peri] = 15
    fat = ndimage.binary_dilation(out > 0, ball(mm(8.0))) & (out == 0)
    out[fat] = 16
    # signed distance to the blood-tissue interface: negative inside blood
    dist_out = ndimage.distance_transform_edt(~blood, sampling=spacing)
    dist_in = ndimage.distance_transform_edt(blood, sampling=spacing)
    sdf = np.where(blood, -dist_in, dist_out).astype(np.float32)
    sdf8 = np.clip(np.round(128 + sdf / SDF_RANGE_MM * 127), 0, 255).astype(np.uint8)
    return out, sdf8

def crop(out, sdf8, spacing, pad_mm=12):
    nz = np.argwhere(out > 0); lo = nz.min(0); hi = nz.max(0) + 1
    p = int(round(pad_mm / spacing[0])); lo = np.maximum(lo - p, 0); hi = np.minimum(hi + p, out.shape)
    sl = tuple(slice(a, b) for a, b in zip(lo, hi))
    return out[sl], sdf8[sl], lo

def atlas(vol):
    """Tile z-slices into a near-square grid; returns image and (cols, rows)."""
    nx, ny, nz = vol.shape
    cols = int(np.ceil(np.sqrt(nz))); rows = int(np.ceil(nz / cols))
    img = np.zeros((rows * ny, cols * nx), np.uint8)
    for k in range(nz):
        r, c = divmod(k, cols)
        img[r * ny:(r + 1) * ny, c * nx:(c + 1) * nx] = vol[:, :, k].T   # rows = y, cols = x
    return Image.fromarray(img), (cols, rows)

def long_axis(lab, spacing):
    pts = np.argwhere(lab == 3).astype(np.float32) * spacing
    if len(pts) < 10: return None
    c = pts.mean(0); u, s, vt = np.linalg.svd(pts - c, full_matrices=False)
    axis = vt[0]
    # point the axis from base (near the LA) to apex: the apex is the end farther from the LA centroid
    la = np.argwhere(lab == 2).astype(np.float32) * spacing
    if len(la):
        lac = la.mean(0)
        if np.dot(axis, c - lac) < 0: axis = -axis
    return c.tolist(), axis.tolist()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src', nargs='?'); ap.add_argument('out'); ap.add_argument('--spacing', type=float, default=1.5); ap.add_argument('--synthetic', action='store_true')
    a = ap.parse_args()
    import os; os.makedirs(a.out, exist_ok=True)
    sp = np.array([a.spacing] * 3, np.float32)
    lab, spacing, affine = synthetic(a.spacing) if a.synthetic else load(a.src, a.spacing)
    out, sdf8 = build(lab, spacing)
    out, sdf8, lo = crop(out, sdf8, spacing)
    img, (cols, rows) = atlas(out); img.save(os.path.join(a.out, 'heart-labels.png'), optimize=True)
    img2, _ = atlas(sdf8); img2.save(os.path.join(a.out, 'heart-sdf.png'), optimize=True)
    centroids = {int(k): (np.argwhere(out == k).mean(0) * spacing).tolist() for k in [1, 2, 3, 4, 5, 6, 7] if (out == k).any()}
    la = long_axis(out, spacing)
    meta = {
        'spacing_mm': float(spacing[0]), 'size': list(map(int, out.shape)), 'tiles': [cols, rows],
        'origin_voxel': list(map(int, lo)), 'sdf_range_mm': SDF_RANGE_MM,
        'labels': {0: 'background', 1: 'LV myocardium', 2: 'LA', 3: 'LV', 4: 'RA', 5: 'RV', 6: 'aorta', 7: 'pulmonary artery', 8: 'LA appendage', 9: 'coronary', 10: 'pulmonary veins', 11: 'thin wall', 12: 'vessel wall', 13: 'mitral plane', 14: 'tricuspid plane', 15: 'pericardium', 16: 'epicardial fat'},
        'centroids_mm': centroids, 'lv_centre_mm': la[0] if la else None, 'lv_axis': la[1] if la else None,
        'source': 'synthetic ellipsoids' if a.synthetic else os.path.basename(a.src),
    }
    json.dump(meta, open(os.path.join(a.out, 'heart-volume.json'), 'w'), indent=1)
    print('volume', out.shape, 'tiles', cols, rows, 'labels', sorted(map(int, np.unique(out))), 'lv axis', la)

if __name__ == '__main__':
    main()
