import SwiftUI
import UIKit

struct ContentView: View {
    @StateObject private var health = HealthKitService()
    @AppStorage("bridgeURL") private var bridgeURL = "http://your-mac.local:8787/api/healthkit/measurements"
    @AppStorage("userId") private var userId = "现场测试用户"
    @State private var uploadMessage = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("现场连接") {
                    TextField("桥接地址", text: $bridgeURL).textInputAutocapitalization(.never).keyboardType(.URL)
                    TextField("测试用户 ID", text: $userId)
                    Text("iPhone 与电脑必须在同一局域网；优先使用电脑的 .local 主机名。").font(.caption).foregroundStyle(.secondary)
                }
                Section("Apple 健康") {
                    LabeledContent("权限请求", value: health.authorizationStatus)
                    LabeledContent("已读取", value: "\(health.measurements.count) 条")
                    Text(health.message).font(.caption)
                    Button("1. 请求读取权限") { Task { await health.requestAuthorization() } }
                    Button("2. 读取最近 22 天") { Task { await health.readLast22Days() } }
                }
                Section("上传") {
                    Button("3. 上传到电脑桥接服务") { Task { await upload() } }
                        .disabled(health.measurements.isEmpty || health.isWorking)
                    if !uploadMessage.isEmpty { Text(uploadMessage).font(.caption) }
                }
                Section("最近真实样本") {
                    ForEach(health.measurements.suffix(20).reversed()) { item in
                        VStack(alignment: .leading) {
                            Text("\(item.metric)  \(item.value, specifier: "%.2f") \(item.unit)")
                            Text("\(item.timestamp) · \(item.metadata["sourceName"] ?? "HealthKit")").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("真实健康同步")
            .disabled(health.isWorking)
        }
    }

    private func upload() async {
        guard let url = URL(string: bridgeURL) else { uploadMessage = BridgeError.invalidServerURL.localizedDescription; return }
        do {
            let payload = HealthKitUpload(userId: userId, generatedAt: ISO8601DateFormatter.bridge.string(from: Date()),
                                          authorizationStatus: health.authorizationStatus, deviceName: UIDevice.current.name,
                                          measurements: health.measurements)
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw BridgeError.emptyResponse }
            guard (200..<300).contains(http.statusCode) else { throw BridgeError.server(http.statusCode, String(data: data, encoding: .utf8) ?? "") }
            let receipt = try JSONDecoder().decode(UploadReceipt.self, from: data)
            uploadMessage = "上传成功：电脑已接收 \(receipt.accepted) 条，时间 \(receipt.receivedAt)"
        } catch {
            uploadMessage = "上传失败：\(error.localizedDescription)。没有改用 Demo 数据。"
        }
    }
}
