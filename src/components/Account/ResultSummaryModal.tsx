import { Box, Button, Flex, Text } from '@chakra-ui/react';
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

export interface ResultSummaryRow {
    alias: string;
    name: string;
    status: '成功' | '失败' | '警告' | '中止' | '错误' | '跳过' | '待确认';
    /** 失败原因摘要（成功时为空） */
    detail?: string;
}

interface ResultSummaryProps {
    title: string;
    rows: ResultSummaryRow[];
}

/** 执行结果汇总窗：一行一个账号（可带失败原因），替代原批量结果表 */
const ResultSummaryModal = NiceModal.create(({ title, rows }: ResultSummaryProps) => {
    const modal = useModal();
    const okCount = rows.filter((r) => r.status === '成功' || r.status === '跳过').length;
    const failCount = rows.length - okCount;
    const finish = async () => {
        modal.resolve();
        await modal.hide();
    };
    return (
        <Modal isOpen={modal.visible} onClose={finish} size="md" closeOnOverlayClick={false}>
            <ModalOverlay />
            <ModalContent>
                <ModalHeader>{title}</ModalHeader>
                <ModalCloseButton />
                <ModalBody>
                    <Text fontSize="sm" color="fg.muted" mb={2}>
                        完成 {okCount} / 需关注 {failCount}
                    </Text>
                    <Box maxH="55vh" overflowY="auto" p={2} borderRadius="md" borderWidth="1px" borderColor="border" bg="bg.panel">
                        {rows.map((row) => (
                            <Flex key={row.alias} align="center" justify="space-between" gap={2} py={1} px={1} borderRadius="md" _hover={{ bg: 'bg.subtle' }}>
                                <Text fontSize="sm" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                                    {row.name}
                                </Text>
                                <Flex align="center" gap={2} flexShrink={0}>
                                    {row.detail && (
                                        <Text fontSize="xs" color="fg.muted" maxW="220px" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis" title={row.detail}>
                                            {row.detail}
                                        </Text>
                                    )}
                                    <Text fontSize="sm" color={row.status === '成功' || row.status === '跳过' ? 'green.fg' : row.status === '警告' || row.status === '中止' || row.status === '待确认' ? 'orange.fg' : 'red.fg'} fontWeight="bold">
                                        {row.status}
                                    </Text>
                                </Flex>
                            </Flex>
                        ))}
                        {rows.length === 0 && (
                            <Text fontSize="sm" color="fg.muted" py={4} textAlign="center">
                                本次没有可执行的账号
                            </Text>
                        )}
                    </Box>
                    <Text mt={2} fontSize="xs" color="fg.muted">
                        关闭后可在各账号详情的功能区里查看完整结果。
                    </Text>
                </ModalBody>
                <ModalFooter>
                    <Button colorPalette="blue" onClick={finish}>
                        知道了
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
});

export default ResultSummaryModal;
