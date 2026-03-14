#!/bin/sh
set -e

REPO="docs-mirror/docs-mirror"
INSTALL_DIR="$HOME/.docs-mirror/bin"

detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    linux)  PLATFORM="linux" ;;
    darwin) PLATFORM="darwin" ;;
    *)
      echo "Error: unsupported OS: $OS" >&2
      exit 1
      ;;
  esac

  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)
      echo "Error: unsupported architecture: $ARCH" >&2
      exit 1
      ;;
  esac

  BINARY="docs-mirror-${PLATFORM}-${ARCH}"
}

get_latest_version() {
  if command -v curl >/dev/null 2>&1; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//')
  elif command -v wget >/dev/null 2>&1; then
    VERSION=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//')
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi

  if [ -z "$VERSION" ]; then
    echo "Error: could not determine latest version" >&2
    exit 1
  fi
}

download() {
  URL="https://github.com/$REPO/releases/download/$VERSION/${BINARY}.bin"
  echo "Downloading docs-mirror $VERSION for $PLATFORM-$ARCH..."

  mkdir -p "$INSTALL_DIR"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$INSTALL_DIR/docs-mirror"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$INSTALL_DIR/docs-mirror" "$URL"
  fi

  chmod +x "$INSTALL_DIR/docs-mirror"
}

setup_path() {
  SHELL_NAME=$(basename "$SHELL" 2>/dev/null || echo "bash")

  case "$SHELL_NAME" in
    zsh)  RC="$HOME/.zshrc" ;;
    fish) RC="$HOME/.config/fish/config.fish" ;;
    *)    RC="$HOME/.bashrc" ;;
  esac

  if [ -f "$RC" ] && grep -q "$INSTALL_DIR" "$RC" 2>/dev/null; then
    return
  fi

  if [ "$SHELL_NAME" = "fish" ]; then
    mkdir -p "$(dirname "$RC")"
    echo "set -gx PATH $INSTALL_DIR \$PATH" >> "$RC"
  else
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$RC"
  fi
}

main() {
  detect_platform
  get_latest_version
  download
  setup_path

  echo ""
  echo "docs-mirror $VERSION installed to $INSTALL_DIR/docs-mirror"
  echo ""
  echo "Restart your shell or run:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  echo ""
  echo "Then run:"
  echo "  docs-mirror --help"
}

main
