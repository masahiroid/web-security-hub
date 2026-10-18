// Official release assets. Update URL, byte length and SHA-256 together after verification.
export const ZAP_RUNTIME = {
  "zap": {
    "url": "https://github.com/zaproxy/zaproxy/releases/download/v2.17.0/ZAP_2.17.0_Crossplatform.zip",
    "sha256": "94c8f767b1c2e94f0db66b3ae56514d5e3f5a728ee1b6c798e0c8fe2d61fbff0",
    "bytes": 286652857,
    "name": "ZAP_2.17.0_Crossplatform.zip"
  },
  "java": {
    "darwin-arm64": {
      "url": "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_aarch64_mac_hotspot_17.0.20.1_1.tar.gz",
      "sha256": "190480874ccceb358cbc840393207f77ac3e63a4c5f8129d0e23e9518b96ad05",
      "bytes": 42722113,
      "name": "OpenJDK17U-jre_aarch64_mac_hotspot_17.0.20.1_1.tar.gz"
    },
    "darwin-x64": {
      "url": "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_mac_hotspot_17.0.20.1_1.tar.gz",
      "sha256": "333cb81123c36568586646c73c8fa2326dab8badc43f5ea388a90fff59c9df27",
      "bytes": 37635516,
      "name": "OpenJDK17U-jre_x64_mac_hotspot_17.0.20.1_1.tar.gz"
    },
    "win32-x64": {
      "url": "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip",
      "sha256": "bc21a93923103cdaac93ee337b0ae4365e739fde36df823dd456bc67c8a9d352",
      "bytes": 43780109,
      "name": "OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip"
    }
  }
} as const;
export const ZAP_RUNTIME_VERSION = "zap-2.17.0-temurin-17.0.20.1-1";
