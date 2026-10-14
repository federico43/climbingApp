import { createContext, PropsWithChildren, use, useContext, useEffect, useState } from 'react'
import {account} from '@/components/AppWrite'
import { authErrorKind, CREDENTIALS_MESSAGE, OFFLINE_MESSAGE, type AuthErrorKind } from '@/utils/network'
import { ID, Models } from 'appwrite'
import { logRecord, getUsers} from '@/services/BoulderGraphService'
import { registerForPushNotificationsAsync, savePushToken } from '@/services/notifications'
import { useRouter } from 'expo-router'
//how do you use use context 
//create the information structure. has to be a type object. Obviously.
type auth_information = {
    User: Models.User<Models.Preferences> | null;
    error: null | string
    // What the last error was: no connection, wrong email/password, other.
    errorKind: AuthErrorKind | null
    // Re-reads the session (e.g. after the connection comes back).
    refreshUser: () => Promise<void>
    isLoadingUser: boolean
    signUp: (email: string, password: string, username:string )  => Promise<void|boolean>
    signIn: (email: string, password: string )  => Promise<void|boolean>
    signOut: () => Promise<void>
    sendRecovery: (email: string) => Promise<boolean>
    userName: string | null
    role: "coach" | "athlete" | null
    assignedProtocolId: string | null
}

//create the context constructor 
export const Context_constructor = createContext<auth_information | undefined >(undefined)

export default function Auth_context({children}:PropsWithChildren) {
    const [error, setErrorText] = useState<null| string>(null)
    const [errorKind, setErrorKind] = useState<AuthErrorKind | null>(null)
    const setError = (message: string | null) => { setErrorText(message); if (message === null) setErrorKind(null) }
    // Sign-in / sign-up / recovery failures: a connection problem and wrong
    // credentials get their own clear message (utils/network).
    const failWith = (error: unknown, fallback: string) => {
        const kind = authErrorKind(error)
        setErrorKind(kind)
        setErrorText(kind === "network" ? OFFLINE_MESSAGE
            : kind === "credentials" && error instanceof Error && (error as any).code === 401 ? CREDENTIALS_MESSAGE
            : error instanceof Error ? error.message : fallback)
    }
    const [user,setUser] = useState<Models.User<Models.Preferences > | null>(null)
    const [isLoadingUser, setisLoadingUser] = useState<boolean>(true)
    const [userName, setusername] = useState('')
    const router = useRouter()
    const [role, setRole] = useState<"coach" | "athlete" | null>(null)
    const [assignedProtocolId, setAssignedProtocolId] = useState<string | null>(null)
    useEffect(() => {
        getUser();
    }, [])

    // Fire-and-forget: ask for notification permission and save this device's
    // Expo push token on the user's row. Never blocks sign-in/session-restore.
    const registerPushToken = (userId: string) => {
        registerForPushNotificationsAsync().then((token) => {
            if (token) savePushToken(userId, token)
        })
    }

    const getUser = async () => {
    try {
        const session = await account.get()
        setUser(session)
        const userInfo = await getUsers(session.$id)
        if (userInfo) {
        setusername(userInfo.username)
        setRole(userInfo.role ?? null)
        setAssignedProtocolId(userInfo.assignedProtocolId ?? null)
        }
        registerPushToken(session.$id)
    } catch (error) {
        console.log(error)
        setUser(null)
    } finally {
        setisLoadingUser(false)
    }
    }
    
    const getUserName = async (id:string) => {
        try {const userInformation = await getUsers(id)
            if(userInformation)
            return userInformation.username
        }
        catch(error){
            console.log(error)
        }
    }


    const  signUpFunction = async (email: string, password: string, username:string ) => {
    setError(null)
    const userId =  ID.unique()
    console.log(userId)
    try{
            await account.create({
                userId: userId,
                email: email,
                password: password
            })
            console.log(userId)
            await logRecord('users', { username: username}, userId)
            setusername(username)
            setError(null) 
            return true 
            }
        catch (error){
            failWith(error, "An error accured during sign up")
            return false
        }
    }
    const  signInFunction = async (email: string, password: string ) => {
        try{
            await account.createEmailPasswordSession({email: email,password: password})
            const session = await account.get()
            setUser(session)
            setError(null)
            registerPushToken(session.$id)
            return true
        }catch (error){
            failWith(error, "An error accured during sign in")
            return false
        }
    }
    const sendRecovery = async (email: string): Promise<boolean> => {
        setError(null)
        try {
            await account.createRecovery(email, 'https://poetic-daifuku-bc250a.netlify.app/')
            return true
        } catch (error) {
            failWith(error, "Could not send recovery email.")
            return false
        }
    }

    const signOut = async () =>{
        
        try {
            await account.deleteSession("current")
            setUser(null)  
            router.replace("/auth")
        } catch (error) {
            console.log(error)
        }
    } 
 
  return (
    <Context_constructor.Provider value={{ signOut, signUp: signUpFunction, signIn: signInFunction, sendRecovery, error, errorKind, refreshUser: getUser, User: user, isLoadingUser, userName, role,
  assignedProtocolId }} >
        {children}
    </Context_constructor.Provider>
  )
}

export function ConsumeAuth(){
    const authState = useContext(Context_constructor)
    if(authState === undefined){
        throw new Error("error example")
    } return authState
}

// Same as ConsumeAuth, but named as a hook so the React Compiler treats it as
// one — it caches plain `ConsumeAuth()` calls, skipping useContext on later
// renders ("change in the order of Hooks").
export function useAuth(){
    return ConsumeAuth()
}

