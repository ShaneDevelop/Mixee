{ pkgs }: {
    deps = [
        pkgs.nodePackages.nodejs
        pkgs.libuuid
        pkgs.pkg-config
        pkgs.cairo
        pkgs.pango
        pkgs.libpng
        pkgs.libjpeg
        pkgs.giflib
        pkgs.librsvg
        pkgs.pixman
    ];
}