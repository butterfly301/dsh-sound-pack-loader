# dsh-sound-pack-loader

一个独立的通用 DSH 通知音效插件，插件本身不含任何主题音效，既可由整合包通过 `pack.sounds` 注入离线音频，也可在独立设置页上传自定义音频并在窗口失焦/后台或始终模式下对全会话的完成、异常失败与等待确认事件播放短音。

- **独立设置页**：在 DSH 设置侧栏注册「通知音效 / Notify sound」页面，支持总静音、触发时机（仅后台或失焦 / 始终提醒）、总音量、分事件开关、自定义音频上传/恢复默认与试听，与整合包设置页共享同一配置与存储接口、实时双向同步。
- **防扰民策略**：用户主动取消或中断任务保持静音；同类事件 2 秒节流，单通道新音打断旧音；单次播放超过 10 秒自动淡出停止。

## 独立安装与配置

```bash
dsh plugin --profile desktop add dsh-sound-pack-loader
```

可在 `cordis.patch.yml` 中注入默认主题音效包：

```yaml
- insert:
    - id: dsh-sound-pack-loader
      name: 'dsh-sound-pack-loader'
      config:
        muted: false
        volume: 0.8
        triggerMode: background
        events:
          completed: true
          failed: true
          waiting: false
        pack:
          sounds:
            completed: 'data:audio/wav;base64,...'
            failed: 'data:audio/wav;base64,...'
            waiting: 'data:audio/wav;base64,...'
```

## 宿主路由与事件

- `GET /sound-pack-loader/poll?since=<cursor>`：轮询新产生的 `completed` / `failed` / `waiting` 会话事件。
- `GET /sound-pack-loader/custom`：读取自定义音频槽位状态与大小限制 `maxBytes`（默认 2 MB）。
- `GET | POST | DELETE /sound-pack-loader/custom/<kind>`：读写或清除 `completed` / `failed` / `waiting` 槽位（支持 WAV、MP3、OGG、M4A、FLAC、WebM，落盘 `~/.dsh/sound-pack-loader/`）。
- 前端自定义事件 `dsh:sound-pack-loader:preview`（试听）与 `dsh:sound-pack-loader:updated`（槽位更新同步）。

## 许可

MIT
