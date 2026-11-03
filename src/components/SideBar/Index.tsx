import {
    Box,
    Button,
    Flex,
    FlexProps,
    Icon,
    Image,
    Text,
    useBreakpointValue,
} from '@chakra-ui/react'
import {
    FiCompass,
    FiHome,
    FiMessageSquare,
    FiUsers,
} from 'react-icons/fi'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { LuMoon, LuSun } from 'react-icons/lu'
import { useColorMode } from '../ui/color-mode'

import { IconType } from 'react-icons'
import { Route as InfoRoute } from "@routes/daily/_sidebar/account/index";
import { Route as LoginRoute } from "@routes/daily/login";
import { Route as UsersRoute } from "@routes/daily/_sidebar/user/index";
import { Route as ArenaRoute } from "@routes/daily/_sidebar/arena/index";
import { ValidateResponse } from '@/interfaces/Account'
import autopcr from "@/assets/autopcr.svg"
import { postLogout } from '@api/Login'
import { toaster } from '../../components/ui/toaster'
import {useEffect} from 'react'
import {useUserRole} from "@api/Account.ts";
import RunningStatus from '../Account/RunningStatus';
import { ScheduleNotifyWatcher } from '../Account/ScheduleNotify';

interface NavItemProps extends FlexProps {
    icon?: IconType
    children: React.ReactNode
    href?: string
}

const NavItem = ({ icon, children, href, onClick, ...rest }: NavItemProps) => {
    const content = (
        <Flex
            align="center"
            gap={{ base: 1, md: 2 }}
            minH="44px"
            px={{ base: 2, md: 3 }}
            borderRadius="md"
            whiteSpace="nowrap"
            role="group"
            cursor="pointer"
            transition="all 0.2s"
            color="fg.muted"
            _hover={{
                bg: 'bg.subtle',
                color: 'fg',
                transform: 'translateY(-1px)'
            }}
            onClick={onClick}
            {...rest}>
            {icon && (
                <Icon
                    flexShrink={0}
                    fontSize={{ base: '16px', md: '18px' }}
                    as={icon}
                />
            )}
            <Text fontSize={{ base: 'xs', md: 'sm' }} fontWeight="medium">{children}</Text>
        </Flex>
    );

    if (href) {
        return (
            <Link 
                to={href} 
                activeProps={{ 
                    style: { 
                        fontWeight: "bold",
                        backgroundColor: "var(--chakra-colors-sidebar-active-bg)",
                        color: "var(--chakra-colors-sidebar-active-fg)",
                    } 
                }}
                style={{ textDecoration: 'none', borderRadius: 'var(--chakra-radii-md)' }}
            >
                {content}
            </Link>
        )
    }

    return content
}

export default function Nav() {
    const { colorMode, toggleColorMode } = useColorMode()
    const role = useUserRole();
    const isSmallScreen = useBreakpointValue({ base: true, md: false });

    const navigate = useNavigate();

    useEffect(() => {
        const eventSource = new EventSource('/daily/api/query_validate');

        eventSource.onmessage = function(event) {
            const res: ValidateResponse = JSON.parse(event.data as string) as ValidateResponse;
            if (res.status !== 'ok') {
                window.open(res.url, '_blank');
            }
        };

        eventSource.onerror = function() {
            // console.error('Error receiving SSE', err);
        };

        return () => {
            eventSource.close();
        };
    }, []);

    const handleLogout = async () => {
        try {
            const res = await postLogout();
            toaster.create({ title: "登出成功", description: res, type: "success" });
            await navigate({ to: LoginRoute.to });
        } catch {
            // Error is handled globally
        }
    }

    return (
        <Flex flexDirection="column" height="100dvh" bg="bg.canvas">
            <Box zIndex={20} bg="transparent" px={{ base: 2, md: 4 }} flexShrink={0}>
                <Flex minH={14} align="center" justify="space-between" wrap={{ base: 'wrap', md: 'nowrap' }}
                    columnGap={{ base: 2, md: 4 }} py={{ base: 1, md: 0 }}>
                    <Box order={0} flexShrink={0}>
                        <Link to={InfoRoute.to}>
                            <Image src={autopcr} alt="AutoPCR" h={{ base: '26px', md: '32px' }} w="auto" objectFit="contain" />
                        </Link>
                    </Box>
                    <Flex as="nav" aria-label="主导航" order={{ base: 2, md: 1 }} gap={{ base: 1, md: 2 }}
                        flexBasis={{ base: '100%', md: 'auto' }} wrap={{ base: 'wrap', md: 'nowrap' }}
                        borderTopWidth={{ base: '1px', md: '0' }} borderColor="border.subtle">
                        <NavItem key="dashboard" href={InfoRoute.to} icon={FiHome} >
                            一览
                        </NavItem>
                        <NavItem key="arena" href={ArenaRoute.to} icon={FiMessageSquare}>
                            竞技场消息
                        </NavItem>
                        {role?.admin && <NavItem key="user" href={UsersRoute.to} icon={FiUsers}>
                            用户管理
                        </NavItem>}
                        <NavItem key="logout" icon={FiCompass} onClick={handleLogout}>
                            登出
                        </NavItem>
                    </Flex>
                    <Flex order={{ base: 1, md: 2 }} align="center" gap={{ base: 1, md: 2 }} flexShrink={0}>
                        <RunningStatus />
                        <Button
                            aria-label="切换配色"
                            onClick={toggleColorMode}
                            size={isSmallScreen ? "sm" : "md"}
                            px={0}
                            variant="ghost"
                            colorPalette="brand"
                        >
                            {colorMode === 'light' ? <LuSun /> : <LuMoon />}
                        </Button>
                    </Flex>
                </Flex>
            </Box>

            <Flex p={{ base: 2, md: 4 }} flex={1} minH={0} minW={0} overflow="auto" flexDirection="column" zIndex={1}>
                <ScheduleNotifyWatcher />
                <Outlet />
            </Flex>

            <Box py={0} pb={2} bg="transparent" px={4} textAlign='right'>
                <Text fontSize="xs" color="fg.muted">
                    Powered by <a href="https://github.com/cc004/autopcr" target="_blank" rel="noreferrer">AutoPCR</a> & <a href="https://github.com/Lanly109/AutoPCR_Web" target="_blank" rel="noreferrer">AutoPCR_Web</a> · {APP_VERSION}
                </Text>
            </Box>
        </Flex>
    )
}
