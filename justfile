_default:
    @just --list

# Bump manifest.json to VERSION, commit, tag vVERSION and push (the tag push runs the release workflow)
release version:
    git diff --quiet && git diff --cached --quiet || (echo "Working tree not clean" && exit 1)
    perl -pi -e 's/"version": "[^"]*"/"version": "{{version}}"/' manifest.json
    git commit -am "Bump version to {{version}}"
    git tag v{{version}}
    git push origin main v{{version}}
