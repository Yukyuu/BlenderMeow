package com.buildermeow.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentPickerPlugin.class);
        registerPlugin(MeowBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @CapacitorPlugin(name = "DocumentPicker")
    public static class DocumentPickerPlugin extends Plugin {

        @PluginMethod
        public void pick(PluginCall call) {
            String mode = call.getString("mode", "document");
            Intent intent;
            if ("gallery".equals(mode)) {
                intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
                intent.setType("image/*");
            } else {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                JSArray mimeArr = call.getArray("mimeTypes");
                if (mimeArr != null && mimeArr.length() > 0) {
                    try {
                        List<String> list = new ArrayList<>();
                        for (int i = 0; i < mimeArr.length(); i++) {
                            String m = mimeArr.getString(i);
                            if (m != null && !m.isEmpty()) list.add(m);
                        }
                        if (!list.isEmpty()) {
                            intent.putExtra(Intent.EXTRA_MIME_TYPES, list.toArray(new String[0]));
                        }
                    } catch (Exception ignored) {}
                }
            }
            startActivityForResult(call, intent, "handlePickResult");
        }

        @ActivityCallback
        private void handlePickResult(PluginCall call, ActivityResult result) {
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                JSObject ret = new JSObject();
                ret.put("cancelled", true);
                call.resolve(ret);
                return;
            }
            Uri uri = result.getData().getData();
            try {
                ContentResolver cr = getContext().getContentResolver();
                String mime = cr.getType(uri);
                if (mime == null) mime = "application/octet-stream";
                String name = queryDisplayName(cr, uri);
                if (name == null || name.isEmpty()) name = "imported_file";

                byte[] bytes;
                try (InputStream is = cr.openInputStream(uri);
                     ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
                    if (is == null) throw new IllegalStateException("Cannot open input stream");
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = is.read(buf)) != -1) {
                        bos.write(buf, 0, n);
                    }
                    bytes = bos.toByteArray();
                }

                JSObject ret = new JSObject();
                ret.put("cancelled", false);
                ret.put("name", name);
                ret.put("mimeType", mime);
                ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("读取文件失败: " + e.getMessage(), e);
            }
        }

        @PluginMethod
        public void pickFolder(PluginCall call) {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            startActivityForResult(call, intent, "handleFolderResult");
        }

        @ActivityCallback
        private void handleFolderResult(PluginCall call, ActivityResult result) {
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                JSObject ret = new JSObject();
                ret.put("cancelled", true);
                call.resolve(ret);
                return;
            }
            Uri treeUri = result.getData().getData();
            try {
                ContentResolver cr = getContext().getContentResolver();
                final int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                try {
                    cr.takePersistableUriPermission(treeUri, takeFlags);
                } catch (Exception ignored) {}

                String docId = DocumentsContract.getTreeDocumentId(treeUri);
                String name = docId;
                int colon = docId != null ? docId.indexOf(':') : -1;
                if (colon >= 0 && colon + 1 < docId.length()) {
                    name = docId.substring(colon + 1);
                }

                JSObject ret = new JSObject();
                ret.put("cancelled", false);
                ret.put("uri", treeUri.toString());
                ret.put("name", name != null && !name.isEmpty() ? name : treeUri.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("无法选择目录: " + e.getMessage(), e);
            }
        }

        @PluginMethod
        public void saveToTree(PluginCall call) {
            String treeUriStr = call.getString("treeUri");
            String filename = call.getString("filename");
            String mimeType = call.getString("mimeType", "application/octet-stream");
            String b64 = call.getString("data");
            if (treeUriStr == null || filename == null || b64 == null) {
                call.reject("缺少保存参数");
                return;
            }
            try {
                ContentResolver cr = getContext().getContentResolver();
                Uri treeUri = Uri.parse(treeUriStr);
                String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
                Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);

                Uri targetDocUri = findChildDocument(cr, treeUri, treeDocId, filename);
                if (targetDocUri == null) {
                    targetDocUri = DocumentsContract.createDocument(cr, parentDocUri, mimeType, filename);
                }
                if (targetDocUri == null) {
                    call.reject("无法创建目标文件");
                    return;
                }

                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                try (OutputStream os = cr.openOutputStream(targetDocUri, "wt")) {
                    if (os == null) throw new IllegalStateException("无法打开输出流");
                    os.write(bytes);
                    os.flush();
                }

                JSObject ret = new JSObject();
                ret.put("uri", targetDocUri.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("保存失败: " + e.getMessage(), e);
            }
        }

        private static Uri findChildDocument(ContentResolver cr, Uri treeUri, String parentDocId, String displayName) {
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
            String[] proj = new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME
            };
            try (Cursor c = cr.query(childrenUri, proj, null, null, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        String childId = c.getString(0);
                        String childName = c.getString(1);
                        if (displayName.equals(childName)) {
                            return DocumentsContract.buildDocumentUriUsingTree(treeUri, childId);
                        }
                    }
                }
            } catch (Exception ignored) {}
            return null;
        }

        private static String queryDisplayName(ContentResolver cr, Uri uri) {
            try (Cursor c = cr.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    return c.getString(0);
                }
            } catch (Exception ignored) {}
            return null;
        }
    }

    @CapacitorPlugin(name = "MeowBridge")
    public static class MeowBridgePlugin extends Plugin {

        public static final String ACTION_IMPORT_FROM_BUILDER = "com.pixelpad.app.ACTION_IMPORT_FROM_BUILDER";
        public static final String TARGET_PACKAGE = "com.pixelpad.app";
        public static final String TARGET_ACTIVITY = "com.pixelpad.app.MainActivity";

        private static final ExecutorService IO_EXEC = Executors.newSingleThreadExecutor();
        private static final Map<String, File> SESSIONS = new ConcurrentHashMap<>();

        private static String sanitizeName(String raw) {
            String safe = raw == null ? "" : raw.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            return safe.isEmpty() ? "builder_model.psd" : safe;
        }

        private void cleanupStaleFiles(File dir) {
            long cutoff = System.currentTimeMillis() - 10 * 60 * 1000L;
            File[] existing = dir.listFiles();
            if (existing == null) return;
            for (File f : existing) {
                if (f.lastModified() < cutoff && !SESSIONS.containsValue(f)) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        }

        @PluginMethod
        public void beginHandoff(PluginCall call) {
            String safeName = sanitizeName(call.getString("filename", "builder_model.psd"));
            Context ctx = getContext().getApplicationContext();
            IO_EXEC.execute(() -> {
                try {
                    File dir = new File(ctx.getCacheDir(), "handoff");
                    if (!dir.exists()) dir.mkdirs();
                    cleanupStaleFiles(dir);
                    String handoffId = UUID.randomUUID().toString();
                    String uniqueName = "h_" + System.currentTimeMillis() + "_" + handoffId.substring(0, 8) + "_" + safeName;
                    File outFile = new File(dir, uniqueName);
                    try (FileOutputStream fos = new FileOutputStream(outFile, false)) {
                        fos.flush();
                    }
                    SESSIONS.put(handoffId, outFile);
                    JSObject ret = new JSObject();
                    ret.put("handoffId", handoffId);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("初始化发送文件失败: " + e.getMessage(), e);
                }
            });
        }

        @PluginMethod
        public void appendHandoffChunk(PluginCall call) {
            String handoffId = call.getString("handoffId");
            String chunk = call.getString("chunk");
            if (handoffId == null || chunk == null) {
                call.reject("缺少分片参数");
                return;
            }
            IO_EXEC.execute(() -> {
                File outFile = SESSIONS.get(handoffId);
                if (outFile == null) {
                    call.reject("发送会话不存在或已结束");
                    return;
                }
                try {
                    byte[] bytes = Base64.decode(chunk, Base64.DEFAULT);
                    try (FileOutputStream fos = new FileOutputStream(outFile, true)) {
                        fos.write(bytes);
                        fos.flush();
                    }
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("写入分片失败: " + e.getMessage(), e);
                }
            });
        }

        @PluginMethod
        public void cancelHandoff(PluginCall call) {
            String handoffId = call.getString("handoffId");
            if (handoffId == null) {
                call.resolve();
                return;
            }
            IO_EXEC.execute(() -> {
                File f = SESSIONS.remove(handoffId);
                if (f != null && f.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
                call.resolve();
            });
        }

        @PluginMethod
        public void commitAndLaunchPixelMeow(PluginCall call) {
            String handoffId = call.getString("handoffId");
            String safeName = sanitizeName(call.getString("filename", "builder_model.psd"));
            String mimeType = call.getString("mimeType", "application/octet-stream");
            String importMode = call.getString("importMode", "new_project");
            String projectName = call.getString("projectName", "BuilderMeow");
            if (handoffId == null || handoffId.isEmpty()) {
                call.reject("缺少 handoffId");
                return;
            }
            Context ctx = getContext().getApplicationContext();
            IO_EXEC.execute(() -> {
                File outFile = SESSIONS.remove(handoffId);
                if (outFile == null || !outFile.exists()) {
                    call.reject("待发送文件不存在");
                    return;
                }
                try {
                    String authority = ctx.getPackageName() + ".fileprovider";
                    Uri contentUri = FileProvider.getUriForFile(ctx, authority, outFile);

                    Intent intent = new Intent(ACTION_IMPORT_FROM_BUILDER);
                    intent.setComponent(new ComponentName(TARGET_PACKAGE, TARGET_ACTIVITY));
                    intent.setDataAndType(contentUri, mimeType);
                    intent.putExtra(Intent.EXTRA_STREAM, contentUri);
                    intent.putExtra("filename", safeName);
                    intent.putExtra("importMode", importMode);
                    intent.putExtra("projectName", projectName);
                    intent.putExtra("handoffId", handoffId);
                    intent.setClipData(ClipData.newRawUri("handoff", contentUri));
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP);

                    PackageManager pm = ctx.getPackageManager();
                    List<ResolveInfo> matches = pm.queryIntentActivities(intent, 0);
                    if (matches == null || matches.isEmpty()) {
                        //noinspection ResultOfMethodCallIgnored
                        outFile.delete();
                        JSObject ret = new JSObject();
                        ret.put("launched", false);
                        ret.put("reason", "not_installed");
                        call.resolve(ret);
                        return;
                    }

                    try {
                        ctx.grantUriPermission(TARGET_PACKAGE, contentUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (Exception ignored) {}

                    Activity act = getActivity();
                    if (act != null && !act.isFinishing()) {
                        act.runOnUiThread(() -> {
                            JSObject ret = new JSObject();
                            try {
                                act.startActivity(intent);
                                ret.put("launched", true);
                            } catch (ActivityNotFoundException | SecurityException err) {
                                //noinspection ResultOfMethodCallIgnored
                                outFile.delete();
                                ret.put("launched", false);
                                ret.put("reason", "not_installed");
                            }
                            call.resolve(ret);
                        });
                    } else {
                        JSObject ret = new JSObject();
                        try {
                            ctx.startActivity(intent);
                            ret.put("launched", true);
                        } catch (ActivityNotFoundException | SecurityException err) {
                            //noinspection ResultOfMethodCallIgnored
                            outFile.delete();
                            ret.put("launched", false);
                            ret.put("reason", "not_installed");
                        }
                        call.resolve(ret);
                    }
                } catch (Exception e) {
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                    call.reject("联动发送失败: " + e.getMessage(), e);
                }
            });
        }
    }
}
