#!/bin/bash

pip install --break-system-packages --user git-filter-repo 2>/dev/null || pip3 install --break-system-packages --user git-filter-repo

git apply /mnt/d/faktury_remove_secret_password.patch
git add -A
git commit -m "Usun hardcodowane haslo dostepu z App.tsx"

echo 'ONEDRIVE_SHARED_SECRET_REDACTED==>ONEDRIVE_SHARED_SECRET_REDACTED_REDACTED' > /tmp/replacements.txt
echo 'REDACTED_SECRET==>REDACTED_SECRET' >> /tmp/replacements.txt

python3 ~/git-filter-repo --replace-text /tmp/replacements.txt --force

git remote add origin https://github.com/marcinkolacz-cloud/faktury.git 2>/dev/null || true
git push origin --force --all
git push origin --force --tags
