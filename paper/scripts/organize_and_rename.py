import os
import shutil

# 1. Update package.json version to 2.1.0
pkg_path = 'dsh-oswyn/package.json'
with open(pkg_path, 'r', encoding='utf-8') as f:
    pkg_content = f.read()

pkg_content = pkg_content.replace('"version": "1.6.8"', '"version": "2.1.0"')
with open(pkg_path, 'w', encoding='utf-8') as f:
    f.write(pkg_content)
print('Updated dsh-oswyn/package.json to version 2.1.0')

# 2. Rename paper file in dsh-oswyn/paper/
src_paper = 'dsh-oswyn/paper/oswyn-empirical-paper.md'
dst_paper = 'dsh-oswyn/paper/oswyn-paper.md'
if os.path.exists(src_paper):
    with open(src_paper, 'r', encoding='utf-8') as f:
        c = f.read()
    c = c.replace('oswyn-empirical-paper.md', 'oswyn-paper.md')
    with open(dst_paper, 'w', encoding='utf-8') as f:
        f.write(c)
    os.remove(src_paper)
    print(f'Renamed {src_paper} -> {dst_paper}')

# Also rename in deliverables/paper/
deliv_src = 'deliverables/paper/oswyn-empirical-paper.md'
deliv_dst = 'deliverables/paper/oswyn-paper.md'
if os.path.exists(deliv_src):
    with open(deliv_src, 'r', encoding='utf-8') as f:
        c = f.read()
    c = c.replace('oswyn-empirical-paper.md', 'oswyn-paper.md')
    with open(deliv_dst, 'w', encoding='utf-8') as f:
        f.write(c)
    os.remove(deliv_src)
    print(f'Renamed {deliv_src} -> {deliv_dst}')

# Also copy/sync to deliverables/oswyn-paper.md
shutil.copyfile(dst_paper, 'deliverables/oswyn-paper.md')
if os.path.exists('deliverables/oswyn-empirical-paper.md'):
    os.remove('deliverables/oswyn-empirical-paper.md')
print('Synced deliverables/oswyn-paper.md')

# 3. Remove paper's README ("论文的readme去掉")
for p in ['dsh-oswyn/paper/README.md', 'deliverables/paper/README.md']:
    if os.path.exists(p):
        os.remove(p)
        print(f'Removed {p}')

# 4. Clean up loose duplicate files in dsh-oswyn/paper/
loose_paper_files = [
    'dsh-oswyn/paper/run-unified-oswyn-benchmarks.mjs',
    'dsh-oswyn/paper/unified-oswyn-realsession-results.json',
    'dsh-oswyn/paper/exp4-intelligence-boundary-results.json',
    'dsh-oswyn/paper/context-growth-curves.svg',
    'dsh-oswyn/paper/willingness-difficulty-models.svg',
    'dsh-oswyn/paper/intelligence-boundary-comparison.svg',
    'dsh-oswyn/paper/.~lock.oswyn-empirical-paper.md#',
    'dsh-oswyn/paper/.DS_Store',
    'dsh-oswyn/.DS_Store',
    'dsh-oswyn/lib/.DS_Store'
]
for p in loose_paper_files:
    if os.path.exists(p):
        os.remove(p)
        print(f'Removed loose file: {p}')

# 5. Clean up loose duplicate files in deliverables/ and deliverables/paper/
loose_deliv_files = [
    'deliverables/context-growth-curves.svg',
    'deliverables/willingness-difficulty-models.svg',
    'deliverables/intelligence-boundary-comparison.svg',
    'deliverables/paper/run-unified-oswyn-benchmarks.mjs',
    'deliverables/paper/unified-oswyn-realsession-results.json',
    'deliverables/paper/exp4-intelligence-boundary-results.json',
    'deliverables/paper/context-growth-curves.svg',
    'deliverables/paper/willingness-difficulty-models.svg',
    'deliverables/paper/intelligence-boundary-comparison.svg'
]
for p in loose_deliv_files:
    if os.path.exists(p):
        os.remove(p)
        print(f'Removed loose deliverable file: {p}')

print('Organization and cleanup complete!')
