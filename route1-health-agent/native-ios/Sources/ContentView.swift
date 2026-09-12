import SwiftUI
import UIKit

struct ContentView: View {
    @StateObject private var health = HealthKitService()
    @StateObject private var uploader = HealthKitBridgeUploader()
    @AppStorage("bridgeURL") private var bridgeURL = "http://your-mac.local:8787/api/healthkit/measurements"
    @AppStorage("userId") private var userId = "现场测试用户"
    @AppStorage("bridgeToken") private var bridgeToken = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("现场连接") {
                    TextField("桥接地址", text: $bridgeURL).textInputAutocapitalization(.never).keyboardType(.URL)
                    TextField("测试用户 ID", text: $userId)
                    SecureField("可选测试 Token", text: $bridgeToken).textInputAutocapitalization(.never)
                    Text("iPhone 与电脑必须在同一局域网；优先使用电脑的 .local 主机名。").font(.caption).foregroundStyle(.secondary)
                }
                Section("Apple 健康") {
                    LabeledContent("权限请求", value: health.authorizationStatus)
                    LabeledContent("已读取", value: "\(health.measurements.count) 条")
                    LabeledContent("最后读取", value: health.lastReadAt?.formatted(date: .abbreviated, time: .standard) ?? "尚未读取")
                    LabeledContent("自动同步", value: health.automaticSyncStatus)
                    LabeledContent("最后自动同步", value: health.lastAutomaticSyncAt?.formatted(date: .abbreviated, time: .standard) ?? "等待变化")
                    Text(health.message).font(.caption)
                    Button("1. 请求读取权限") { Task { await health.requestAuthorization() } }
                    Button("2. 读取最近 22 天") { Task { await health.readLast22Days() } }
                }
                Section("上传") {
                    LabeledContent("最后上传状态", value: uploader.lastUploadAt?.formatted(date: .abbreviated, time: .standard) ?? "尚未上传")
                    LabeledContent("Bridge revision", value: uploader.lastRevision.map(String.init) ?? "尚无")
                    Button("3. 上传到电脑桥接服务") { Task { await upload() } }
                        .disabled(health.measurements.isEmpty || health.isWorking || uploader.isUploading)
                    if !uploader.message.isEmpty { Text(uploader.message).font(.caption) }
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
            .task {
                await health.startAutomaticSync { measurements, lastReadAt, authorizationStatus in
                    await uploader.upload(
                        measurements: measurements,
                        lastReadAt: lastReadAt,
                        authorizationStatus: authorizationStatus,
                        bridgeURL: bridgeURL,
                        userId: userId,
                        bridgeToken: bridgeToken
                    )
                }
            }
        }
    }

    private func upload() async {
        await uploader.upload(
            measurements: health.measurements,
            lastReadAt: health.lastReadAt,
            authorizationStatus: health.authorizationStatus,
            bridgeURL: bridgeURL,
            userId: userId,
            bridgeToken: bridgeToken
        )
    }
}
