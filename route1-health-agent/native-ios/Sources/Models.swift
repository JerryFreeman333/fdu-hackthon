import Foundation

struct HealthMeasurement: Codable, Identifiable {
    let id: String
    let timestamp: String
    let metric: String
    let value: Double
    let unit: String
    let source: String
    let confidence: Double
    let visibility: String
    let metadata: [String: String]
}

struct HealthKitUpload: Codable {
    let schemaVersion = 1
    let userId: String
    let generatedAt: String
    let authorizationStatus: String
    let deviceName: String
    let measurements: [HealthMeasurement]
}

struct UploadReceipt: Codable {
    let accepted: Int
    let receivedAt: String
}

enum BridgeError: LocalizedError {
    case healthUnavailable
    case invalidServerURL
    case invalidUserId
    case server(Int, String)
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .healthUnavailable: return "此设备无法使用 Apple 健康数据。请在真实 iPhone 上运行。"
        case .invalidServerURL: return "桥接地址无效，请填写完整的 http://电脑名.local:8787/api/healthkit/measurements。"
        case .invalidUserId: return "测试用户 ID 不能为空，且必须与网页配置一致。"
        case let .server(code, body): return "桥接服务返回 HTTP \(code)：\(body)"
        case .emptyResponse: return "桥接服务没有返回确认信息。"
        }
    }
}

extension ISO8601DateFormatter {
    static let bridge: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
