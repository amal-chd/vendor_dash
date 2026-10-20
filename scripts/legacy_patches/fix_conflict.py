import sys

with open('src/components/AdminLayout.tsx', 'r') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    if line.startswith('<<<<<<<'):
        # Conflict marker found
        mine = []
        i += 1
        while not lines[i].startswith('======='):
            mine.append(lines[i])
            i += 1
        i += 1
        other = []
        while not lines[i].startswith('>>>>>>>'):
            other.append(lines[i])
            i += 1
        i += 1 # skip >>>>>>>
        
        # Merge logic
        if any("Contribution Margin" in m for m in mine) and any("Stay Analytics" in o for o in other):
            new_lines.extend(mine)
            new_lines.extend(other)
        elif any("canAccessWorkspace" in m for m in mine) and any("canSeeNavGroup" in o for o in other):
            new_lines.append("    .filter((ws) => !role || isSuperAdmin || bootstrapAdmin || canSeeNavGroup(role, ws.id))\n")
        else:
            print("Unhandled conflict!")
            sys.exit(1)
        continue
    else:
        new_lines.append(line)
        i += 1

with open('src/components/AdminLayout.tsx', 'w') as f:
    f.writelines(new_lines)

