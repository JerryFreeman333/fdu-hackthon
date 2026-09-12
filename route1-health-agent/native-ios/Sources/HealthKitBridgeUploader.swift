import Foundation
import UIKit

@MainActor
final class HealthKitBridgeUploader: ObservableObject {
    @Published var message = ""
    @Published var lastUploadAt: Date?
    @Published var lastRevision: Int?
    @Published var isUploading = false

    @discardableResult
    func upload(
        measurements: [HealthMeasurement],
        lastReadAt: Date?,
        authorizationStatus: String,
        bridgeURL: String,
        userId: String,
        bridgeToken: String
    ) async -> Bool {
        guard !isUploading else {
            message = "已有上传正在进行，本次触发已合并。"
            return false
        }
        guard let url = URL(string: bridgeURL), url.scheme == "http" || url.scheme == "https" else {
            message = BridgeError.invalidServerURL.localizedDescription
            return false
        }
        let normalizedUserId = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserId.isEmpty else {
            message = BridgeError.invalidUserId.localizedDescription
            return false
        }
        guard let lastReadAt, !measurements.isEmpty else {
            message = "上传失败：没有刚读取的真实 HealthKit 数据。未使用 Demo 数据。"
            return false
        }

        isUploading = true
        defer { isUploading = false }
        do {
            let payload = HealthKitUpload(
                userId: normalizedUserId,
                generatedAt: ISO8601DateFormatter.bridge.string(from: lastReadAt),
                authorizationStatus: authorizationStatus,
                deviceName: UIDevice.current.name,
                measurements: measurements
            )
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let token = bridgeToken.trimmingCharacters(in: .whitespacesAndNewlines)
            if !token.isEmpty { request.setValue(token, forHTTPHeaderField: "X-HealthKit-Bridge-Token") }
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw BridgeError.emptyResponse }
            guard (200..<300).contains(http.statusCode) else {
                throw BridgeError.server(http.statusCode, String(data: data, encoding: .utf8) ?? "")
            }
            let receipt = try JSONDecoder().decode(UploadReceipt.self, from: data)
            lastUploadAt = Date()
            lastRevision = receipt.revision
            message = "上传成功：电脑已接收 \(receipt.accepted) 条，revision \(receipt.revision.map(String.init) ?? "未知")"
            return true
        } catch {
            message = "上传失败：\(error.localizedDescription)。未使用 Demo 数据。"
            return false
        }
    }
}
