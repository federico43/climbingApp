import { createContext, PropsWithChildren, use, useContext, useEffect, useState } from 'react'
import {account} from '@/components/AppWrite'
import { ID, Models } from 'appwrite'
import { logRecord, getUsers} from '@/services/BoulderGraphService'
import { useRouter } from 'expo-router'
//how do you use use context 
//create the information structure. has to be a type object. Obviously.
type auth_information = {
    User: Models.User<Models.Preferences> | null; 
    error: null | string
    isLoadingUser: boolean
    signUp: (email: string, password: string, username:string )  => Promise<void|boolean> 
    signIn: (email: string, password: string )  => Promise<void|boolean> 
    signOut: () => Promise<void> 
    userName: string | null
    //defines the name of the object, in this case is signIn. It also defines what type of object it returns. 
}

//create the context constructor 
export const Context_constructor = createContext<auth_information | undefined >(undefined)

export default function Auth_context({children}:PropsWithChildren) {
    const [error, setError] = useState<null| string>(null)
    const [user,setUser] = useState<Models.User<Models.Preferences > | null>(null)
    const [isLoadingUser, setisLoadingUser] = useState<boolean>(true)
    const [userName, setusername] = useState('')
    const router = useRouter()
    useEffect(() => {
        getUser();
    }, [])

    const getUser = async () => {
        try{
             const session = await account.get()
             setUser(session)
             const username = await getUserName(session.$id)
             setusername(username)
        }catch(error){
            console.log(error)
            setUser(null)
        }finally{
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
             if(error instanceof Error){
                setError(  error.message)
            }else {
            setError(  "An error accured during sign up" )
            }
            return false
        }
    }
    const  signInFunction = async (email: string, password: string ) => {
        try{
            await account.createEmailPasswordSession({email: email,password: password})
            const session = await account.get()
            setUser(session)
            setError(null)
            return true  
        }catch (error){
            if(error instanceof Error){
                setError(error.message)
            }else{
                setError(  "An error accured during sign in" )
            }
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
    <Context_constructor.Provider value={{ signOut: signOut,signUp: signUpFunction, signIn: signInFunction, error: error, User: user, isLoadingUser, userName}} >
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

