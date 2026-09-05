'use client';

import React, {
  ChangeEvent,
  ClipboardEvent,
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { Media } from '@prisma/client';
import { useDrag, useDrop } from 'react-dnd';
import { DNDProvider } from '@gitroom/frontend/components/launches/helpers/dnd.provider';
import { useDebounce } from 'use-debounce';
import { Dashboard } from '@uppy/react';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { DropFiles } from '@gitroom/frontend/components/layout/drop.files';
import { ThirdPartyMediaLibrary } from '@gitroom/frontend/components/third-parties/third-party.media-library';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';
import { Pagination } from '@gitroom/frontend/components/media/media.pagination';
import {
  ChevronRightIcon,
  DeleteCircleIcon,
  NoMediaIcon,
  PlusIcon,
  TrashIcon,
} from '@gitroom/frontend/components/ui/icons';
import {
  MediaFolder,
  useMediaFolders,
  useMediaFoldersTrash,
  useMediaList,
  useMediaTrash,
} from '@gitroom/frontend/components/media/use.media.hooks';
import { MediaDeleteConfirmModal } from '@gitroom/frontend/components/media/media.delete.confirm';

type BrowseMode = 'flat' | 'drill';
type ViewMode = 'library' | 'trash';
type FolderFilter = 'all' | 'unfiled' | string;

const MAX_UPLOAD_SIZE = 1024 * 1024 * 1024;

const buildFolderChildren = (
  folders: MediaFolder[],
  parentId: string | null
) =>
  folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

const DRAG_TYPE_MEDIA_FOLDER = 'media-folder';
const DRAG_TYPE_MEDIA_TILE = 'media-tile';

const formatFileSizeMb = (bytes: number) => {
  if (!bytes) {
    return null;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

const getFolderBreadcrumbs = (folders: MediaFolder[], folderId: string | null) => {
  if (!folderId) {
    return [];
  }
  const map = new Map(folders.map((folder) => [folder.id, folder]));
  const crumbs: MediaFolder[] = [];
  let current = map.get(folderId);
  while (current) {
    crumbs.unshift(current);
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  return crumbs;
};

const FolderNameModal: FC<{
  title: string;
  initialName?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}> = ({ title, initialName = '', onSave, onCancel }) => {
  const t = useT();
  const [name, setName] = useState(initialName);

  return (
    <div className="flex flex-col gap-[16px] text-textColor min-w-[320px]">
      <div className="text-[16px] font-[600]">{title}</div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('folder_name', 'Folder name')}
        className="w-full h-[44px] px-[14px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] outline-none focus:border-[#612BD3]"
      />
      <div className="flex justify-end gap-[8px]">
        <button
          onClick={onCancel}
          className="cursor-pointer h-[40px] px-[16px] rounded-[8px] border border-newTextColor/10"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          disabled={!name.trim()}
          onClick={() => onSave(name.trim())}
          className="cursor-pointer h-[40px] px-[16px] rounded-[8px] bg-[#612BD3] text-white disabled:opacity-50"
        >
          {t('save', 'Save')}
        </button>
      </div>
    </div>
  );
};

const FolderTreeItem: FC<{
  folder: MediaFolder;
  folders: MediaFolder[];
  depth: number;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (folder: MediaFolder) => void;
  onDelete?: (folder: MediaFolder) => void;
  allowDelete: boolean;
  onReorder?: (draggedId: string, targetId: string) => void;
  onDropMedia?: (mediaIds: string[], folderId: string) => void;
}> = ({
  folder,
  folders,
  depth,
  activeId,
  onSelect,
  onRename,
  onDelete,
  allowDelete,
  onReorder,
  onDropMedia,
}) => {
  const children = buildFolderChildren(folders, folder.id);

  const [, drag] = useDrag(
    () => ({
      type: DRAG_TYPE_MEDIA_FOLDER,
      item: { id: folder.id },
      canDrag: !!onReorder,
    }),
    [folder.id, onReorder]
  );

  const [{ isFolderOver }, drop] = useDrop(
    () => ({
      accept: [DRAG_TYPE_MEDIA_FOLDER, DRAG_TYPE_MEDIA_TILE],
      canDrop: (item: { id: string }, monitor) => {
        if (monitor.getItemType() === DRAG_TYPE_MEDIA_FOLDER) {
          return !!onReorder && item.id !== folder.id;
        }
        return !!onDropMedia;
      },
      drop: (item: { id: string; ids?: string[] }, monitor) => {
        if (monitor.getItemType() === DRAG_TYPE_MEDIA_FOLDER) {
          onReorder?.(item.id, folder.id);
          return;
        }
        onDropMedia?.(item.ids?.length ? item.ids : [item.id], folder.id);
      },
      collect: (monitor) => ({
        isFolderOver: monitor.isOver() && monitor.canDrop(),
      }),
    }),
    [folder.id, onReorder, onDropMedia]
  );

  return (
    <>
      <div
        className={clsx(
          'group flex items-center gap-[6px] rounded-[6px] px-[8px] py-[6px] cursor-pointer text-[13px]',
          activeId === folder.id
            ? 'bg-[#612BD3]/20 text-white'
            : 'hover:bg-newColColor text-textColor',
          isFolderOver && 'ring-1 ring-[#612BD3]'
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        // @ts-ignore
        ref={(node) => drag(drop(node))}
      >
        <button
          type="button"
          className="flex-1 text-start truncate"
          onClick={() => onSelect(folder.id)}
        >
          {folder.name}
        </button>
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 text-[11px] px-[6px] py-[2px] rounded-[4px] hover:bg-newBgColorInner"
          onClick={(e) => {
            e.stopPropagation();
            onRename(folder);
          }}
        >
          ✎
        </button>
        {allowDelete && onDelete && (
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-[11px] px-[6px] py-[2px] rounded-[4px] hover:bg-red-500/20 text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(folder);
            }}
          >
            ×
          </button>
        )}
      </div>
      {children.map((child) => (
        <FolderTreeItem
          key={child.id}
          folder={child}
          folders={folders}
          depth={depth + 1}
          activeId={activeId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
          allowDelete={allowDelete}
          onReorder={onReorder}
          onDropMedia={onDropMedia}
        />
      ))}
    </>
  );
};

const MediaTile: FC<{
  media: Media;
  isTrash?: boolean;
  standalone?: boolean;
  isAttachSelected: boolean;
  isBulkSelected: boolean;
  isTrashSelected: boolean;
  attachIndex: number;
  fileSizeLabel: string;
  dragIds: string[];
  canDrag: boolean;
  mediaDirectory: ReturnType<typeof useMediaDirectory>;
  onTileClick: () => void;
  onDelete: (e: React.MouseEvent) => Promise<void> | void;
  onMaximize: (e: React.MouseEvent) => Promise<void> | void;
}> = ({
  media,
  isTrash,
  standalone,
  isAttachSelected,
  isBulkSelected,
  isTrashSelected,
  attachIndex,
  fileSizeLabel,
  dragIds,
  canDrag,
  mediaDirectory,
  onTileClick,
  onDelete,
  onMaximize,
}) => {
  const [, drag] = useDrag(
    () => ({
      type: DRAG_TYPE_MEDIA_TILE,
      item: { id: media.id, ids: dragIds },
      canDrag,
    }),
    [media.id, dragIds, canDrag]
  );

  return (
    <div
      className={clsx(
        'group px-[3px] py-[3px] float-left rounded-[6px] w8-max aspect-square',
        !standalone && !isTrash && 'cursor-pointer'
      )}
      key={media.id}
      // @ts-ignore
      ref={canDrag ? drag : undefined}
    >
      <div
        className={clsx(
          'w-full h-full rounded-[6px] border-[4px] relative',
          isAttachSelected || isBulkSelected || isTrashSelected
            ? 'border-[#612BD3]'
            : 'border-transparent'
        )}
        onClick={onTileClick}
      >
        {!isTrash && !standalone && isAttachSelected && (
          <div className="text-white flex z-[101] justify-center items-center text-[14px] font-[500] w-[24px] h-[24px] rounded-full bg-[#612BD3] absolute -bottom-[10px] -end-[10px]">
            {attachIndex + 1}
          </div>
        )}
        {!isTrash && standalone && isBulkSelected && (
          <div className="text-white flex z-[101] justify-center items-center text-[12px] font-[600] w-[22px] h-[22px] rounded-full bg-[#612BD3] absolute -bottom-[8px] -end-[8px]">
            ✓
          </div>
        )}
        {!isTrash && standalone && !isBulkSelected && (
          <DeleteCircleIcon
            className="cursor-pointer hidden z-[100] group-hover:block absolute -top-[5px] -end-[5px]"
            onClick={onDelete}
          />
        )}
        {fileSizeLabel && (
          <div className="absolute top-[10px] start-[10px] z-[100] text-[10px] font-[500] text-white px-[6px] py-[2px] rounded-[4px] bg-black/50">
            {fileSizeLabel}
          </div>
        )}
        <div className="absolute bottom-[10px] end-[10px] z-[100] text-[10px] truncate max-w-[80%]">
          {media.originalName || media.name}
        </div>
        <div className="w-full h-full rounded-[6px] overflow-hidden relative">
          <div className="absolute z-[20] left-[50%] top-[50%] -translate-x-[50%] -translate-y-[50%]">
            <div
              onClick={onMaximize}
              className="cursor-pointer p-[4px] bg-black/40 hidden group-hover:block hover:scale-150 transition-all"
            >
              <svg width="30" height="30" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 9H0V14H5V12H2V9ZM0 5H2V2H5V0H0V5ZM12 12H9V14H14V9H12V12ZM9 0V2H12V5H14V0H9Z"
                  fill="#F1F5F9"
                />
              </svg>
            </div>
          </div>
          {hasExtension(media.path, 'mp4') ? (
            <VideoFrame url={mediaDirectory.set(media.path)} />
          ) : (
            <img
              width="100%"
              height="100%"
              className="w-full h-full object-cover"
              src={mediaDirectory.set(media.path)}
              alt="media"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const MediaBox: FC<{
  setMedia: (params: { id: string; path: string }[]) => void;
  standalone?: boolean;
  type?: 'image' | 'video';
  closeModal: () => void;
}> = ({ type, standalone, setMedia }) => {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const mediaDirectory = useMediaDirectory();

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const [browseMode, setBrowseMode] = useState<BrowseMode>('flat');
  const [viewMode, setViewMode] = useState<ViewMode>('library');
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all');
  const [drillFolderId, setDrillFolderId] = useState<string | null>(null);
  const [usageFilter, setUsageFilter] = useState<'unused' | 'detached' | null>(
    null
  );
  const [selected, setSelected] = useState<any[]>([]);
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [trashPage, setTrashPage] = useState(0);
  const [trashSelectedMedia, setTrashSelectedMedia] = useState<string[]>([]);
  const [trashSelectedFolders, setTrashSelectedFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const uploaderRef = useRef<HTMLInputElement>(null);
  const isTrashView = standalone && viewMode === 'trash';

  const uploadFolderId = useMemo(() => {
    if (browseMode === 'drill') {
      return drillFolderId;
    }
    if (folderFilter !== 'all' && folderFilter !== 'unfiled') {
      return folderFilter;
    }
    return null;
  }, [browseMode, drillFolderId, folderFilter]);

  const listQuery = useMemo(() => {
    if (isTrashView) {
      return {
        enabled: false,
        folderId: null as string | null,
        unfiled: false,
        usage: undefined as 'unused' | 'detached' | undefined,
      };
    }
    if (browseMode === 'drill' && drillFolderId) {
      return {
        enabled: true,
        folderId: drillFolderId,
        unfiled: false,
        usage: standalone ? usageFilter || undefined : undefined,
      };
    }
    if (folderFilter === 'unfiled') {
      return {
        enabled: true,
        folderId: null,
        unfiled: true,
        usage: standalone ? usageFilter || undefined : undefined,
      };
    }
    if (folderFilter !== 'all') {
      return {
        enabled: true,
        folderId: folderFilter,
        unfiled: false,
        usage: standalone ? usageFilter || undefined : undefined,
      };
    }
    return {
      enabled: true,
      folderId: null,
      unfiled: false,
      usage: standalone ? usageFilter || undefined : undefined,
    };
  }, [
    isTrashView,
    browseMode,
    drillFolderId,
    folderFilter,
    standalone,
    usageFilter,
  ]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, folderFilter, drillFolderId, browseMode, usageFilter, viewMode]);

  const { data, mutate, isLoading } = useMediaList({
    page,
    search: debouncedSearch,
    folderId: listQuery.folderId,
    unfiled: listQuery.unfiled,
    usage: listQuery.usage,
    enabled: listQuery.enabled,
  });

  const { data: folders = [], mutate: mutateFolders } = useMediaFolders(
    !isTrashView
  );
  const { data: trashData, mutate: mutateTrash } = useMediaTrash(
    trashPage,
    isTrashView
  );
  const { data: trashFolders = [], mutate: mutateTrashFolders } =
    useMediaFoldersTrash(isTrashView);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      mutate(),
      mutateFolders(),
      mutateTrash(),
      mutateTrashFolders(),
    ]);
  }, [mutate, mutateFolders, mutateTrash, mutateTrashFolders]);

  const uppy = useUppyUploader({
    allowedFileTypes:
      type === 'image'
        ? 'image/*'
        : type === 'video'
        ? 'video/mp4'
        : 'image/*,video/mp4',
    folderId: uploadFolderId,
    onUploadSuccess: async (arr) => {
      await refreshAll();
      if (standalone) {
        return;
      }
      setSelected((prevSelected) => [...prevSelected, ...arr]);
    },
    onStart: () => setLoading(true),
    onEnd: () => setLoading(false),
  });

  const filteredResults = useMemo(() => {
    return (data?.results || []).filter((item: Media) => {
      if (type === 'video') {
        return hasExtension(item.path, 'mp4');
      }
      if (type === 'image') {
        return !hasExtension(item.path, 'mp4');
      }
      return true;
    });
  }, [data?.results, type]);

  const openDeleteConfirm = useCallback(
    (
      count: number,
      consumers: any[],
      onConfirm: () => Promise<void>,
      title?: string,
      description?: string,
      confirmLabel?: string
    ) => {
      modals.openModal({
        title: t('confirm_delete', 'Confirm delete'),
        askClose: true,
        children: (close) => (
          <MediaDeleteConfirmModal
            count={count}
            consumers={consumers}
            title={title}
            description={description}
            confirmLabel={confirmLabel}
            onCancel={close}
            onConfirm={async () => {
              await onConfirm();
              close();
            }}
          />
        ),
      });
    },
    [modals, t]
  );

  const deleteWithWarning = useCallback(
    async (ids: string[], afterDelete?: () => Promise<void>) => {
      if (
        !(await deleteDialog(
          ids.length > 1
            ? t(
                'delete_media_bulk_confirm',
                'Are you sure you want to delete these {{count}} items?',
                { count: ids.length }
              )
            : t(
                'delete_media_confirm',
                'Are you sure you want to delete this item?'
              )
        ))
      ) {
        return;
      }
      const response = await fetch('/media/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      const result = await response.json();
      if (result.requiresConfirm) {
        openDeleteConfirm(result.count, result.consumers, async () => {
          await fetch('/media/bulk', {
            method: 'POST',
            body: JSON.stringify({ ids, confirm: true }),
          });
          await afterDelete?.();
          await refreshAll();
          toaster.show(t('moved_to_trash', 'Moved to trash'), 'success');
        });
        return;
      }
      await afterDelete?.();
      await refreshAll();
      toaster.show(t('moved_to_trash', 'Moved to trash'), 'success');
    },
    [fetch, openDeleteConfirm, refreshAll, t, toaster]
  );

  const deleteFolderWithWarning = useCallback(
    async (folderId: string) => {
      if (
        !(await deleteDialog(
          t(
            'delete_folder_confirm',
            'Are you sure you want to delete this folder?'
          )
        ))
      ) {
        return;
      }
      const response = await fetch(`/media/folders/${folderId}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.requiresConfirm) {
        openDeleteConfirm(
          result.count,
          result.consumers,
          async () => {
            await fetch(`/media/folders/${folderId}?confirm=true`, {
              method: 'DELETE',
            });
            if (drillFolderId === folderId) {
              setDrillFolderId(null);
            }
            await refreshAll();
            toaster.show(t('folder_moved_to_trash', 'Folder moved to trash'), 'success');
          },
          t('delete_folder_in_use', 'Folder contains media still in use')
        );
        return;
      }
      if (drillFolderId === folderId) {
        setDrillFolderId(null);
      }
      await refreshAll();
      toaster.show(t('folder_moved_to_trash', 'Folder moved to trash'), 'success');
    },
    [fetch, openDeleteConfirm, drillFolderId, refreshAll, t, toaster]
  );

  const openFolderNameModal = useCallback(
    (options: {
      title: string;
      initialName?: string;
      onSave: (name: string) => Promise<void>;
    }) => {
      modals.openModal({
        title: options.title,
        children: (close) => (
          <FolderNameModal
            title={options.title}
            initialName={options.initialName}
            onCancel={close}
            onSave={async (name) => {
              await options.onSave(name);
              close();
            }}
          />
        ),
      });
    },
    [modals]
  );

  const createFolder = useCallback(() => {
    openFolderNameModal({
      title: t('create_folder', 'Create folder'),
      onSave: async (name) => {
        await fetch('/media/folders', {
          method: 'POST',
          body: JSON.stringify({
            name,
            parentId:
              browseMode === 'drill' ? drillFolderId || undefined : undefined,
          }),
        });
        await mutateFolders();
        toaster.show(t('folder_created', 'Folder created'), 'success');
      },
    });
  }, [
    browseMode,
    drillFolderId,
    fetch,
    mutateFolders,
    openFolderNameModal,
    t,
    toaster,
  ]);

  const renameFolder = useCallback(
    (folder: MediaFolder) => {
      openFolderNameModal({
        title: t('rename_folder', 'Rename folder'),
        initialName: folder.name,
        onSave: async (name) => {
          await fetch(`/media/folders/${folder.id}`, {
            method: 'PUT',
            body: JSON.stringify({ name }),
          });
          await mutateFolders();
          toaster.show(t('folder_renamed', 'Folder renamed'), 'success');
        },
      });
    },
    [fetch, mutateFolders, openFolderNameModal, t, toaster]
  );

  const moveMediaViaDrag = useCallback(
    async (mediaIds: string[], folderId: string) => {
      if (!mediaIds.length) {
        return;
      }
      try {
        await fetch('/media/move', {
          method: 'POST',
          body: JSON.stringify({ ids: mediaIds, folderId }),
        });
        setBulkSelected((current) =>
          current.filter((id) => !mediaIds.includes(id))
        );
        await refreshAll();
        toaster.show(t('media_moved', 'Media moved'), 'success');
      } catch (err) {
        toaster.show(t('media_move_failed', 'Could not move media'), 'warning');
      }
    },
    [fetch, refreshAll, t, toaster]
  );

  const reorderFolder = useCallback(
    async (draggedId: string, targetId: string) => {
      const dragged = folders.find((folder: MediaFolder) => folder.id === draggedId);
      const target = folders.find((folder: MediaFolder) => folder.id === targetId);
      if (!dragged || !target || dragged.parentId !== target.parentId) {
        return;
      }

      const siblings = buildFolderChildren(folders, dragged.parentId);
      const fromIndex = siblings.findIndex((folder) => folder.id === draggedId);
      const toIndex = siblings.findIndex((folder) => folder.id === targetId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return;
      }

      const reordered = [...siblings];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      const orders = reordered.map((folder, index) => ({
        id: folder.id,
        order: index,
      }));
      const orderById = new Map(orders.map((item) => [item.id, item.order]));
      const previousFolders = folders;

      await mutateFolders(
        folders.map((folder: MediaFolder) =>
          orderById.has(folder.id)
            ? { ...folder, order: orderById.get(folder.id)! }
            : folder
        ),
        { revalidate: false }
      );

      try {
        await fetch('/media/folders/reorder', {
          method: 'POST',
          body: JSON.stringify({ orders }),
        });
        await mutateFolders();
      } catch (err) {
        await mutateFolders(previousFolders, { revalidate: false });
        toaster.show(
          t('folder_reorder_failed', 'Could not reorder folders'),
          'warning'
        );
      }
    },
    [folders, mutateFolders, fetch, t, toaster]
  );

  const restoreTrash = useCallback(async () => {
    if (!trashSelectedMedia.length && !trashSelectedFolders.length) {
      return;
    }
    await fetch('/media/restore', {
      method: 'POST',
      body: JSON.stringify({
        mediaIds: trashSelectedMedia.length ? trashSelectedMedia : undefined,
        folderIds: trashSelectedFolders.length ? trashSelectedFolders : undefined,
      }),
    });
    setTrashSelectedMedia([]);
    setTrashSelectedFolders([]);
    await refreshAll();
    toaster.show(t('restored_from_trash', 'Restored from trash'), 'success');
  }, [fetch, refreshAll, t, toaster, trashSelectedFolders, trashSelectedMedia]);

  const toggleBulk = useCallback((mediaId: string) => {
    setBulkSelected((current) =>
      current.includes(mediaId)
        ? current.filter((id) => id !== mediaId)
        : [...current, mediaId]
    );
  }, []);

  const addRemoveSelected = useCallback(
    (media: Media) => () => {
      if (standalone) {
        toggleBulk(media.id);
        return;
      }
      const exists = selected.find((item) => item.id === media.id);
      if (exists) {
        setSelected(selected.filter((item) => item.id !== media.id));
        return;
      }
      setSelected([...selected, media]);
    },
    [selected, standalone, toggleBulk]
  );

  const addMedia = useCallback(async () => {
    if (standalone) {
      return;
    }
    setMedia(selected);
    modals.closeCurrent();
  }, [modals, selected, setMedia, standalone]);

  const addToUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const totalSize = files.reduce((acc, file) => acc + file.size, 0);
      if (totalSize > MAX_UPLOAD_SIZE) {
        toaster.show(
          t(
            'upload_size_limit_exceeded',
            'Upload size limit exceeded. Maximum 1 GB per upload session.'
          ),
          'warning'
        );
        return;
      }
      setLoading(true);
      uppy.addFiles(files as any);
    },
    [toaster, t, uppy]
  );

  const dragAndDrop = useCallback(
    async (event: ClipboardEvent<HTMLDivElement> | File[]) => {
      const clipboardItems = (event as File[]).map((file) => ({
        kind: 'file',
        getAsFile: () => file,
      }));
      const files: File[] = [];
      for (const item of clipboardItems) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }
      const totalSize = files.reduce((acc, file) => acc + file.size, 0);
      if (totalSize > MAX_UPLOAD_SIZE) {
        toaster.show(
          t(
            'upload_size_limit_exceeded',
            'Upload size limit exceeded. Maximum 1 GB per upload session.'
          ),
          'warning'
        );
        return;
      }
      setLoading(true);
      for (const file of files) {
        uppy.addFile(file);
      }
    },
    [toaster, t, uppy]
  );

  const maximize = useCallback(
    (media: Media) => async (e: React.MouseEvent) => {
      e.stopPropagation();
      modals.openModal({
        title: '',
        top: 10,
        children: (
          <div className="w-full h-full p-[50px]">
            {hasExtension(media.path, 'mp4') ? (
              <VideoFrame autoplay url={mediaDirectory.set(media.path)} />
            ) : (
              <img
                width="100%"
                height="100%"
                className="w-full h-full max-h-[100%] max-w-[100%] object-cover"
                src={mediaDirectory.set(media.path)}
                alt="media"
              />
            )}
          </div>
        ),
      });
    },
    [mediaDirectory, modals]
  );

  const deleteImage = useCallback(
    (media: Media) => async (e: React.MouseEvent) => {
      e.stopPropagation();
      await deleteWithWarning([media.id], async () => {
        setBulkSelected((current) => current.filter((id) => id !== media.id));
      });
    },
    [deleteWithWarning]
  );

  const bulkDelete = useCallback(async () => {
    if (!bulkSelected.length) {
      return;
    }
    const ids = [...bulkSelected];
    await deleteWithWarning(ids, async () => setBulkSelected([]));
  }, [bulkSelected, deleteWithWarning]);

  const uploadButton = useMemo(
    () => (
      <button
        disabled={loading}
        onClick={() => uploaderRef.current?.click()}
        className="relative cursor-pointer bg-btnSimple changeColor flex gap-[8px] h-[44px] px-[18px] justify-center items-center rounded-[8px]"
      >
        {loading ? (
          <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
            <div className="animate-spin h-[20px] w-[20px] border-4 border-white border-t-transparent rounded-full" />
          </div>
        ) : (
          <PlusIcon size={14} />
        )}
        <div className={loading ? 'invisible' : undefined}>
          {t('upload', 'Upload')}
        </div>
      </button>
    ),
    [loading, t]
  );

  const breadcrumbs = getFolderBreadcrumbs(folders, drillFolderId);
  const trashResults = trashData?.results || [];
  const showEmptyLibrary =
    !isLoading && !filteredResults.length && !isTrashView;
  const showEmptyTrash = isTrashView && !trashResults.length && !trashFolders.length;

  const hasSelectableItems = isTrashView
    ? trashResults.length > 0 || trashFolders.length > 0
    : filteredResults.length > 0;

  const allVisibleSelected = isTrashView
    ? hasSelectableItems &&
      trashResults.every((media: Media) => trashSelectedMedia.includes(media.id)) &&
      trashFolders.every((folder: MediaFolder) =>
        trashSelectedFolders.includes(folder.id)
      )
    : hasSelectableItems &&
      filteredResults.every((media: Media) => bulkSelected.includes(media.id));

  const toggleSelectAll = useCallback(() => {
    if (isTrashView) {
      if (allVisibleSelected) {
        setTrashSelectedMedia([]);
        setTrashSelectedFolders([]);
      } else {
        setTrashSelectedMedia(trashResults.map((media: Media) => media.id));
        setTrashSelectedFolders(trashFolders.map((folder: MediaFolder) => folder.id));
      }
      return;
    }
    if (allVisibleSelected) {
      setBulkSelected([]);
    } else {
      setBulkSelected(filteredResults.map((media: Media) => media.id));
    }
  }, [isTrashView, allVisibleSelected, trashResults, trashFolders, filteredResults]);

  const renderMediaTile = (media: Media, options?: { trash?: boolean }) => {
    const isTrash = options?.trash;
    const isAttachSelected = !!selected.find((item) => item.id === media.id);
    const isBulkSelected = bulkSelected.includes(media.id);
    const isTrashSelected = trashSelectedMedia.includes(media.id);
    const fileSizeLabel = formatFileSizeMb(media.fileSize);
    const canDrag = !!standalone && !isTrash;
    const dragIds = isBulkSelected && bulkSelected.length > 1 ? bulkSelected : [media.id];

    return (
      <MediaTile
        key={media.id}
        media={media}
        isTrash={isTrash}
        standalone={standalone}
        isAttachSelected={isAttachSelected}
        isBulkSelected={isBulkSelected}
        isTrashSelected={isTrashSelected}
        attachIndex={selected.findIndex((item) => item.id === media.id)}
        fileSizeLabel={fileSizeLabel}
        dragIds={dragIds}
        canDrag={canDrag}
        mediaDirectory={mediaDirectory}
        onTileClick={
          isTrash
            ? () =>
                setTrashSelectedMedia((current) =>
                  current.includes(media.id)
                    ? current.filter((id) => id !== media.id)
                    : [...current, media.id]
                )
            : addRemoveSelected(media)
        }
        onDelete={deleteImage(media)}
        onMaximize={maximize(media)}
      />
    );
  };

  return (
    <DNDProvider>
    <DropFiles disabled={loading} className="flex flex-col flex-1" onDrop={dragAndDrop}>
      <div className="flex flex-col flex-1 gap-[12px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search_media_by_name', 'Search by file name')}
              className="w-full h-[44px] px-[14px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] outline-none focus:border-[#612BD3]"
            />
          </div>
          <input
            type="file"
            ref={uploaderRef}
            onChange={addToUpload}
            className="hidden"
            multiple
          />
          {!isTrashView && (
            <>
              {uploadButton}
              <ThirdPartyMediaLibrary onImported={() => refreshAll()} />
              <button
                type="button"
                onClick={createFolder}
                className="cursor-pointer h-[44px] px-[14px] rounded-[8px] bg-newColColor text-[13px] font-[600]"
              >
                {t('new_folder', 'New folder')}
              </button>
            </>
          )}
          {standalone && (
            <button
              type="button"
              onClick={() => {
                setViewMode(isTrashView ? 'library' : 'trash');
                setTrashPage(0);
                setBulkSelected([]);
              }}
              className={clsx(
                'cursor-pointer h-[44px] px-[14px] rounded-[8px] flex items-center gap-[6px] text-[13px] font-[600]',
                isTrashView ? 'bg-[#612BD3] text-white' : 'bg-newColColor'
              )}
            >
              <TrashIcon size={14} />
              {isTrashView
                ? t('back_to_library', 'Back to library')
                : t('recently_deleted', 'Recently deleted')}
            </button>
          )}
        </div>

        {!isTrashView && (
          <div className="flex flex-wrap items-center gap-[8px] text-[13px]">
            <button
              type="button"
              onClick={() => setBrowseMode('flat')}
              className={clsx(
                'h-[36px] px-[12px] rounded-[8px]',
                browseMode === 'flat' ? 'bg-[#612BD3] text-white' : 'bg-newColColor'
              )}
            >
              {t('filter_view', 'Filter view')}
            </button>
            <button
              type="button"
              onClick={() => setBrowseMode('drill')}
              className={clsx(
                'h-[36px] px-[12px] rounded-[8px]',
                browseMode === 'drill' ? 'bg-[#612BD3] text-white' : 'bg-newColColor'
              )}
            >
              {t('folder_view', 'Folder view')}
            </button>
            {browseMode === 'flat' && (
              <>
                <button
                  type="button"
                  onClick={() => setFolderFilter('all')}
                  className={clsx(
                    'h-[36px] px-[12px] rounded-[8px]',
                    folderFilter === 'all'
                      ? 'bg-[#612BD3]/80 text-white'
                      : 'bg-newColColor'
                  )}
                >
                  {t('all_media', 'All')}
                </button>
                <button
                  type="button"
                  onClick={() => setFolderFilter('unfiled')}
                  className={clsx(
                    'h-[36px] px-[12px] rounded-[8px]',
                    folderFilter === 'unfiled'
                      ? 'bg-[#612BD3]/80 text-white'
                      : 'bg-newColColor'
                  )}
                >
                  {t('unfiled', 'Unfiled')}
                </button>
                {folders.map((folder: MediaFolder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setFolderFilter(folder.id)}
                    className={clsx(
                      'h-[36px] px-[12px] rounded-[8px] max-w-[160px] truncate',
                      folderFilter === folder.id
                        ? 'bg-[#612BD3]/80 text-white'
                        : 'bg-newColColor'
                    )}
                  >
                    {folder.name}
                  </button>
                ))}
              </>
            )}
            {standalone && (
              <>
                <button
                  type="button"
                  onClick={() => setUsageFilter(null)}
                  className={clsx(
                    'h-[36px] px-[12px] rounded-[8px]',
                    !usageFilter ? 'bg-[#612BD3]/80 text-white' : 'bg-newColColor'
                  )}
                >
                  {t('all_usage', 'All usage')}
                </button>
                <button
                  type="button"
                  onClick={() => setUsageFilter('unused')}
                  className={clsx(
                    'h-[36px] px-[12px] rounded-[8px]',
                    usageFilter === 'unused'
                      ? 'bg-[#612BD3]/80 text-white'
                      : 'bg-newColColor'
                  )}
                >
                  {t('unused_media', 'Unused')}
                </button>
                <button
                  type="button"
                  onClick={() => setUsageFilter('detached')}
                  className={clsx(
                    'h-[36px] px-[12px] rounded-[8px]',
                    usageFilter === 'detached'
                      ? 'bg-[#612BD3]/80 text-white'
                      : 'bg-newColColor'
                  )}
                >
                  {t('detached_media', 'Used before')}
                </button>
              </>
            )}
          </div>
        )}

        {standalone && hasSelectableItems && (
          <div>
            <button
              type="button"
              onClick={toggleSelectAll}
              className="h-[34px] px-[12px] rounded-[8px] bg-newColColor text-[12px] font-[600]"
            >
              {allVisibleSelected
                ? t('deselect_all', 'Deselect all')
                : t('select_all', 'Select all')}
            </button>
          </div>
        )}

        {standalone && !isTrashView && bulkSelected.length > 0 && (
          <div className="flex flex-wrap items-center gap-[8px] rounded-[8px] bg-newColColor/60 px-[12px] py-[10px]">
            <span className="text-[13px] font-[600]">
              {t('selected_count', '{{count}} selected', {
                count: bulkSelected.length,
              })}
            </span>
            <button
              type="button"
              onClick={bulkDelete}
              className="h-[34px] px-[12px] rounded-[8px] bg-red-600 text-white text-[12px] font-[600]"
            >
              {t('delete_selected', 'Delete selected')}
            </button>
            <button
              type="button"
              onClick={() => setBulkSelected([])}
              className="h-[34px] px-[12px] rounded-[8px] text-[12px]"
            >
              {t('clear_selection', 'Clear')}
            </button>
          </div>
        )}

        {isTrashView && (trashSelectedMedia.length > 0 || trashSelectedFolders.length > 0) && (
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={restoreTrash}
              className="h-[36px] px-[14px] rounded-[8px] bg-[#612BD3] text-white text-[13px] font-[600]"
            >
              {t('restore_selected', 'Restore selected')}
            </button>
          </div>
        )}

        {!isTrashView && (
          <div className="w-full pointer-events-none relative">
            <div className="w-full h-[46px] overflow-hidden absolute left-0 bg-newBgColorInner uppyChange">
              <Dashboard
                height={46}
                uppy={uppy}
                id="uploader"
                showProgressDetails
                hideUploadButton
                hideRetryButton
                hidePauseResumeButton
                hideCancelButton
                hideProgressAfterFinish
              />
            </div>
            <div className="w-full h-[46px] uppyChange" />
          </div>
        )}

        <div className="flex flex-1 gap-[12px] min-h-[320px]">
          {!isTrashView && browseMode === 'drill' && (
            <div className="w-[220px] shrink-0 rounded-[10px] bg-newBgColorInner border border-newColColor p-[10px] overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner">
              <button
                type="button"
                onClick={() => setDrillFolderId(null)}
                className={clsx(
                  'w-full text-start px-[8px] py-[6px] rounded-[6px] text-[13px] mb-[4px]',
                  !drillFolderId ? 'bg-[#612BD3]/20' : 'hover:bg-newColColor'
                )}
              >
                {t('all_media', 'All media')}
              </button>
              {buildFolderChildren(folders, null).map((folder) => (
                <FolderTreeItem
                  key={folder.id}
                  folder={folder}
                  folders={folders}
                  depth={0}
                  activeId={drillFolderId}
                  onSelect={setDrillFolderId}
                  onRename={renameFolder}
                  onDelete={standalone ? (folder) => deleteFolderWithWarning(folder.id) : undefined}
                  allowDelete={!!standalone}
                  onReorder={standalone ? reorderFolder : undefined}
                  onDropMedia={standalone ? moveMediaViaDrag : undefined}
                />
              ))}
            </div>
          )}

          <div className="flex-1 flex flex-col min-w-0">
            {!isTrashView && browseMode === 'drill' && breadcrumbs.length > 0 && (
              <div className="flex items-center gap-[6px] text-[12px] text-newTextColor/70 mb-[8px] flex-wrap">
                <button
                  type="button"
                  className="hover:text-white"
                  onClick={() => setDrillFolderId(null)}
                >
                  {t('all_media', 'All media')}
                </button>
                {breadcrumbs.map((crumb) => (
                  <React.Fragment key={crumb.id}>
                    <ChevronRightIcon size={12} />
                    <button
                      type="button"
                      className={clsx(
                        'hover:text-white',
                        drillFolderId === crumb.id && 'text-white font-[600]'
                      )}
                      onClick={() => setDrillFolderId(crumb.id)}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}

            <div
              className={clsx(
                'flex-1 relative',
                (showEmptyLibrary || showEmptyTrash) &&
                  'bg-newTextColor/[0.02] rounded-[12px]'
              )}
            >
              <div
                className={clsx(
                  'absolute -left-[3px] -top-[3px] withp3 h-full overflow-x-hidden overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner',
                  (showEmptyLibrary || showEmptyTrash) &&
                    'flex justify-center items-center gap-[20px] flex-col'
                )}
              >
                {showEmptyLibrary && (
                  <>
                    <NoMediaIcon />
                    <div className="text-[20px] font-[600]">
                      {debouncedSearch
                        ? t('no_media_match_search', 'No media matches your search')
                        : t('you_dont_have_any_media_yet', "You don't have any media yet")}
                    </div>
                    {!debouncedSearch && (
                      <div className="forceChange flex gap-[8px]">
                        {uploadButton}
                        <ThirdPartyMediaLibrary onImported={() => refreshAll()} />
                      </div>
                    )}
                  </>
                )}

                {showEmptyTrash && (
                  <div className="text-[16px] text-newTextColor/70">
                    {t('trash_is_empty', 'Trash is empty')}
                  </div>
                )}

                {isLoading && !isTrashView && (
                  <>
                    {[...new Array(16)].map((_, index) => (
                      <div
                        key={index}
                        className="px-[3px] py-[3px] float-left rounded-[6px] w8-max aspect-square"
                      >
                        <div className="w-full h-full bg-newSep rounded-[6px] animate-pulse" />
                      </div>
                    ))}
                  </>
                )}

                {!isTrashView &&
                  !isLoading &&
                  filteredResults.map((media: Media) => renderMediaTile(media))}

                {isTrashView && (
                  <>
                    {trashFolders.map((folder: MediaFolder) => (
                      <div
                        key={folder.id}
                        className={clsx(
                          'w-full mb-[8px] px-[12px] py-[10px] rounded-[8px] border cursor-pointer',
                          trashSelectedFolders.includes(folder.id)
                            ? 'border-[#612BD3] bg-[#612BD3]/10'
                            : 'border-newColColor bg-newBgColorInner'
                        )}
                        onClick={() =>
                          setTrashSelectedFolders((current) =>
                            current.includes(folder.id)
                              ? current.filter((id) => id !== folder.id)
                              : [...current, folder.id]
                          )
                        }
                      >
                        <div className="text-[13px] font-[600]">{folder.name}</div>
                        <div className="text-[11px] text-newTextColor/60">
                          {t('folder_in_trash', 'Folder')}
                        </div>
                      </div>
                    ))}
                    {trashResults.map((media: Media) => renderMediaTile(media, { trash: true }))}
                  </>
                )}
              </div>
            </div>

            {!isTrashView && (data?.pages || 0) > 1 && (
              <Pagination
                current={page}
                totalPages={data.pages}
                setPage={setPage}
              />
            )}
            {isTrashView && (trashData?.pages || 0) > 1 && (
              <Pagination
                current={trashPage}
                totalPages={trashData.pages}
                setPage={setTrashPage}
              />
            )}
          </div>
        </div>

        {!standalone && (
          <div className="flex justify-end mt-[16px] gap-[8px]">
            <button
              onClick={() => modals.closeCurrent()}
              className="cursor-pointer h-[52px] px-[20px] items-center justify-center border border-newTextColor/10 flex rounded-[10px]"
            >
              {t('cancel', 'Cancel')}
            </button>
            {!isLoading && !!filteredResults.length && (
              <button
                onClick={addMedia}
                disabled={selected.length === 0}
                className="cursor-pointer text-white disabled:opacity-80 disabled:cursor-not-allowed h-[52px] px-[20px] items-center justify-center bg-[#612BD3] flex rounded-[10px]"
              >
                {t('add_selected_media', 'Add selected media')}
              </button>
            )}
          </div>
        )}
      </div>
    </DropFiles>
    </DNDProvider>
  );
};
