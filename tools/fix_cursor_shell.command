#!/bin/bash
set -euo pipefail

BACKUP_DT=$(date +%Y%m%d%H%M%S)

echo "Backing up shell files (if present) with suffix .bak.$BACKUP_DT"
for f in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.zshenv"; do
  if [ -f "$f" ]; then cp "$f" "$f.bak.$BACKUP_DT"; fi
done

cat > "$HOME/.zshrc_cursor_fix.zsh" <<'EOF'
# Auto-generated Cursor shell cleanup
# Disables undefined hook calls and eval wrappers that break commands inside Cursor's terminal
if [[ "$TERM_PROGRAM" == "Cursor" ]]; then
  # Remove undefined hook callers
  unset -f dump_zsh_state 2>/dev/null || true

  # Clear any preexec/precmd hook arrays injected by other tooling
  typeset -a preexec_functions 2>/dev/null || true
  typeset -a precmd_functions 2>/dev/null || true
  preexec_functions=()
  precmd_functions=()

  # Provide no-op hooks to prevent re-injection
  preexec() { :; }
  precmd() { :; }
fi
EOF

# Ensure the fix is sourced from ~/.zshrc (create if missing)
touch "$HOME/.zshrc"
if ! grep -q ".zshrc_cursor_fix.zsh" "$HOME/.zshrc"; then
  printf "\n# Source Cursor shell fix\n[[ -f \$HOME/.zshrc_cursor_fix.zsh ]] && source \$HOME/.zshrc_cursor_fix.zsh\n" >> "$HOME/.zshrc"
fi

echo "Installed Cursor shell fix. Close and reopen embedded terminals (or run: source ~/.zshrc)."

