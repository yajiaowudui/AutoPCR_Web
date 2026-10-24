import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { Candidate, ConfigValue } from '@interfaces/Module';
import {
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
} from '../../components/ui/modal';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useRef, useState } from 'react';

import { IoClose } from 'react-icons/io5';
import { toaster } from '../ui/toaster';
import { getErrorDescription } from './accountShared';

interface MultiSelectModalProps {
    candidates: Candidate[];
    value: ConfigValue[];
    smartSelect?: () => Promise<ConfigValue[]>;
}

const multiSelectModal = NiceModal.create(({ candidates, value, smartSelect }: MultiSelectModalProps) => {
    const modal = useModal();

    const initValue = Array.isArray(value) ? value : [];
    const [selectedUnits, setSelectedUnits] = useState<ConfigValue[]>(initValue);
    const [availableUnits, setAvailableUnits] = useState<Candidate[]>(candidates.filter((u) => !initValue.includes(u.value)));
    const [searchAllText, setSearchAllText] = useState('');
    const [searchSelectedText, setSearchSelectedText] = useState('');
    const [draggedUnit, setDraggedUnit] = useState<ConfigValue | null>(null);
    const [selecting, setSelecting] = useState(false);
    const selectRequestRef = useRef(0);

    const lastVisibleRef = useRef(false);

    if (modal.visible && !lastVisibleRef.current) {
        selectRequestRef.current += 1;
        setSelecting(false);
        setSelectedUnits(initValue);
        setAvailableUnits(candidates.filter(u => !initValue.includes(u.value)));
        setSearchAllText('');
        setSearchSelectedText('');
    }

    lastVisibleRef.current = modal.visible;

    const handleAdd = (id: ConfigValue) => {
        if (!selectedUnits.includes(id)) {
            setSelectedUnits([...selectedUnits, id]);
            setAvailableUnits(availableUnits.filter((u) => u.value !== id));
        }
    };

    const handleRemove = (id: ConfigValue) => {
        setSelectedUnits(selectedUnits.filter(i => i !== id));
        const unit = candidates.find(u => u.value === id);
        if (unit) setAvailableUnits([...availableUnits, unit]);
    };

    const handleSave = () => {
        modal.resolve(selectedUnits);
        modal.hide();
    };

    const handleClose = () => {
        selectRequestRef.current += 1;
        setSelecting(false);
        modal.resolve(undefined);
        modal.hide();
    };

    const handleSmartSelect = async () => {
        if (!smartSelect || selecting) return;
        const requestId = ++selectRequestRef.current;
        setSelecting(true);
        try {
            const ids = await smartSelect();
            if (requestId !== selectRequestRef.current) return;
            const allowed = new Set(candidates.map(candidate => candidate.value));
            const selected = [...new Set(ids)].filter(id => allowed.has(id));
            if (selected.length === 0) {
                toaster.create({ type: 'error', title: '未找到当前账号可选的角色' });
                return;
            }
            setSelectedUnits(selected);
            setAvailableUnits(candidates.filter(candidate => !selected.includes(candidate.value)));
            setSearchAllText('');
            setSearchSelectedText('');
            toaster.create({ type: 'success', title: `已智能选取${selected.length}名角色，点击保存生效` });
        } catch (err) {
            const description = await getErrorDescription(err);
            if (requestId !== selectRequestRef.current) return;
            toaster.create({ type: 'error', title: '智能选取失败', description });
        } finally {
            if (requestId === selectRequestRef.current) setSelecting(false);
        }
    };

    const moveUnit = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;

        const newSelectedUnits = [...selectedUnits];
        const [movedUnit] = newSelectedUnits.splice(fromIndex, 1);
        newSelectedUnits.splice(toIndex, 0, movedUnit);

        setSelectedUnits(newSelectedUnits);
    };

    const handleDragStart = (unitId: ConfigValue) => {
        setDraggedUnit(unitId);
    };

    const handleDragEnd = () => {
        setDraggedUnit(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = (e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        if (draggedUnit === null) return;

        const sourceIndex = selectedUnits.indexOf(draggedUnit);
        if (sourceIndex !== -1) {
            moveUnit(sourceIndex, targetIndex);
        }
    };
    const handleClearAll = () => {
        setSelectedUnits([]);
        setAvailableUnits(candidates);
    };

    const filteredAvailable = availableUnits.filter((u) => String(u.value).includes(searchAllText) || String(u.display).includes(searchAllText) || u.tags?.some((tag) => tag.toLowerCase().includes(searchAllText.toLowerCase())));

    const selectedObjects = selectedUnits.map((id) => {
        const u = candidates.find((u) => u.value === id);
        return u ?? { value: id, display: id, tags: [], nickname: null };
    });

    const filteredSelected = selectedObjects.filter(u =>
        String(u.value).includes(searchSelectedText) ||
        u.tags?.some(tag => tag.toLowerCase().includes(searchSelectedText.toLowerCase()))
    );

    return (
        <Modal isOpen={modal.visible} onClose={handleClose} size="xl">
            <ModalOverlay />
            <ModalContent>
                <ModalHeader>选择</ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                    {smartSelect && (
                        <Box mb={3}>
                            <Button size="sm" colorPalette="blue" loading={selecting} onClick={handleSmartSelect}>
                                智能选取最高品级20人
                            </Button>
                            <Text fontSize="xs" color="fg.muted" mt={1}>
                                按品级、等级、战力依次优先，替换当前选择；保存后生效。
                            </Text>
                        </Box>
                    )}
                    <Flex gap={4} pointerEvents={selecting ? 'none' : 'auto'} opacity={selecting ? 0.6 : 1}>
                        <Box flex={1}>
                            <Text mb={2}>未选择 ({availableUnits.length})</Text>
                            <Input placeholder="搜索" mb={2} value={searchAllText} onChange={(e) => setSearchAllText(e.target.value)} />
                            <Box maxH="55vh" overflowY="auto" p={2} borderRadius="md" borderWidth="1px" borderColor="border" bg="bg.panel">
                                <Button
                                    size="sm"
                                    colorPalette="green"
                                    onClick={() => {
                                        const allValues = filteredAvailable.map(u => u.value);
                                        setSelectedUnits([...new Set([...selectedUnits, ...allValues])]);
                                        setAvailableUnits(availableUnits.filter(u => !allValues.includes(u.value)));
                                    }}
                                >
                                    全选
                                </Button>
                                {filteredAvailable.map((u, id) => (
                                    <Box key={id} p={1} cursor="pointer" _hover={{ bg: "bg.subtle" }} onClick={() => handleAdd(u.value)}>
                                        {u.nickname ? u.nickname : u.display}
                                    </Box>
                                ))}
                            </Box>
                        </Box>

                        <Box flex={1}>
                            <Text mb={2}>已选择 ({selectedUnits.length})</Text>
                            <Input placeholder="搜索" mb={2} value={searchSelectedText} onChange={(e) => setSearchSelectedText(e.target.value)} />
                            <Box maxH="55vh" overflowY="auto" p={2} borderRadius="md" borderWidth="1px" borderColor="border" bg="bg.panel">
                                <Flex mb={2} alignItems="center" justifyContent="space-between">
                                    <Text fontSize="xs" color="fg.muted">
                                        提示：拖拽可调整顺序
                                    </Text>
                                    <Button onClick={handleClearAll} size={'sm'} colorPalette="red">
                                        清空
                                    </Button>
                                </Flex>

                                {filteredSelected.map((u) => {
                                    const actualIndex = selectedUnits.indexOf(u.value);
                                    return (
                                        <Flex key={String(u.value)} alignItems="center" justifyContent="space-between" _hover={{ bg: "bg.subtle" }}>
                                            <Box
                                                p={1}
                                                cursor="grab"
                                                draggable
                                                onDragStart={() => handleDragStart(u.value)}
                                                onDragEnd={handleDragEnd}
                                                onDragOver={handleDragOver}
                                                onDrop={(e) => handleDrop(e, actualIndex)}
                                                flex={1}
                                                display="flex"
                                                justifyContent="space-between"
                                                alignItems="center"
                                            >
                                                {u.nickname ? u.nickname : u.display}
                                                <Button variant="ghost" colorPalette="red" aria-label="移除" size="xs" onClick={() => handleRemove(u.value)} px={0}>
                                                    <IoClose />
                                                </Button>
                                            </Box>
                                        </Flex>
                                    );
                                })}
                            </Box>
                        </Box>
                    </Flex>
                </ModalBody>

                <ModalFooter>
                    <Button onClick={handleSave} colorPalette="blue" mr={3} disabled={selecting}>
                        保存
                    </Button>
                    <Button variant="ghost" onClick={handleClose}>取消</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
});
NiceModal.register('multiSelectModal', multiSelectModal);
export default multiSelectModal;
